import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import DOMPurify from "dompurify";
import ePub from "epubjs";
import { Headphones } from "lucide-react";
import { KokoroTTS } from "kokoro-js";

import { HiddenFileInput } from "./components/HiddenFileInput";
import { LibraryPanel } from "./components/LibraryPanel";
import { MobileNavigation } from "./components/MobileNavigation";
import { PlaybackPanel } from "./components/PlaybackPanel";
import { ReaderPanel } from "./components/ReaderPanel";
import type {
  Book,
  Chapter,
  NavItem,
  PlaybackState,
  VoiceId,
} from "./types/reader";

const VOICE_OPTIONS: ReadonlyArray<{ label: string; value: VoiceId }> = [
  { label: "Heart", value: "af_heart" },
  { label: "Alloy", value: "af_alloy" },
  { label: "Echo", value: "am_echo" },
];

const MAX_CHAPTER_CHARACTERS = 8000;

const isTauriEnvironment = () =>
  typeof window !== "undefined" &&
  typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
    .__TAURI_INTERNALS__?.invoke === "function";

const ensureEpubSignature = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer.slice(0, 2));
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Please choose a valid EPUB file.");
  }
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `wl-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
};

const deriveTitleFromPath = (filepath: string) => {
  const filename = filepath.split(/[/\\]/).pop() ?? "Untitled";
  return filename.replace(/\.epub$/i, "").replace(/[-_]+/g, " ").trim();
};

const buildNavigationMap = (items?: NavItem[]) => {
  const map = new Map<string, string>();
  const visit = (nodes?: NavItem[]) => {
    if (!nodes) return;
    nodes.forEach((node) => {
      if (!node) return;
      const key = node.href?.split("#")[0];
      if (key) {
        map.set(key, node.label?.trim() ?? "");
      }
      if (node.subitems?.length) {
        visit(node.subitems);
      }
    });
  };
  visit(items);
  return map;
};

const sanitizeChapterHtml = (html: unknown) => {
  if (typeof html !== "string") {
    console.warn("Unexpected HTML payload type from epub chapter:", typeof html);
    return "";
  }

  const stripped = html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\?xml[^>]*\?>/gi, "");

  try {
    return DOMPurify.sanitize(stripped, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ["svg", "math", "path", "g"],
      ADD_ATTR: ["xmlns", "viewBox", "xlink:href", "xml:lang"],
    });
  } catch (error) {
    console.warn("DOMPurify failed to sanitize chapter, falling back.", error);
    return stripped.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  }
};

const extractPlainText = (html: unknown) => {
  if (typeof html !== "string") {
    return "";
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  } catch (error) {
    console.warn("DOMParser could not extract plain text, using fallback.", error);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
};

function App() {
  const [library, setLibrary] = useState<Book[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | undefined>(
    undefined,
  );
  const [activeChapterId, setActiveChapterId] = useState<string | undefined>(
    undefined,
  );
  const [activeView, setActiveView] = useState<"library" | "reader" | "player">(
    "library",
  );
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [voice, setVoice] = useState<VoiceId>(VOICE_OPTIONS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const ttsRef = useRef<KokoroTTS | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const activeChapterForAudio = useRef<string | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeBook = useMemo(() => {
    if (!activeBookId) return undefined;
    return library.find((book) => book.id === activeBookId);
  }, [library, activeBookId]);

  const activeChapter = useMemo(() => {
    if (!activeBook || !activeChapterId) return undefined;
    return activeBook.chapters.find((chapter) => chapter.id === activeChapterId);
  }, [activeBook, activeChapterId]);

  const resetProgress = useCallback(() => {
    setProgress(0);
    setDuration(0);
  }, []);

  const releaseAudioResources = useCallback(() => {
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }

    const audio = audioElementRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audio.removeAttribute("src");
      audio.load();
    }
    audioElementRef.current = null;
    activeChapterForAudio.current = null;

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    resetProgress();
    setPlaybackState("idle");
  }, [resetProgress]);

  useEffect(() => {
    return () => {
      releaseAudioResources();
    };
  }, [releaseAudioResources]);

  useEffect(() => {
    if (!library.length) {
      setActiveBookId(undefined);
      setActiveChapterId(undefined);
      return;
    }

    if (!activeBookId || !library.some((book) => book.id === activeBookId)) {
      const firstBook = library[0];
      setActiveBookId(firstBook.id);
      setActiveChapterId(firstBook.chapters[0]?.id);
      return;
    }

    const selectedBook = library.find((book) => book.id === activeBookId);
    if (
      selectedBook &&
      (!activeChapterId ||
        !selectedBook.chapters.some((chapter) => chapter.id === activeChapterId))
    ) {
      setActiveChapterId(selectedBook.chapters[0]?.id);
    }
  }, [library, activeBookId, activeChapterId]);

  const loadTts = useCallback(async () => {
    if (ttsRef.current) {
      return ttsRef.current;
    }
    setIsLoadingModel(true);
    try {
      const model = await KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        {
          dtype: "q4",
          device: "webgpu",
        },
      );
      ttsRef.current = model;
      return model;
    } finally {
      setIsLoadingModel(false);
    }
  }, []);

  const attachAudioEvents = useCallback((audio: HTMLAudioElement) => {
    const handleTimeUpdate = () => {
      setProgress(audio.currentTime);
      setDuration(audio.duration || 0);
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      setProgress(audio.currentTime);
    };

    const handlePlay = () => setPlaybackState("playing");
    const handlePause = () => {
      if (!audio.ended) {
        setPlaybackState("paused");
      }
    };
    const handleEnded = () => {
      setPlaybackState("idle");
      setProgress(audio.duration || 0);
    };
    const handleError = () => {
      setError("The audio element encountered an error.");
      setPlaybackState("idle");
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, []);

  const generateAudioForChapter = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error("There's nothing in this chapter to play.");
      }

      if (trimmed.length > MAX_CHAPTER_CHARACTERS) {
        throw new Error(
          "This chapter is quite long. Try splitting it into smaller sections before generating audio.",
        );
      }

      const tts = await loadTts();
      const audio = await tts.generate(trimmed, {
        voice,
      });

      setProgress(0);
      setDuration(0);

      const blob = audio.toBlob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const element = new Audio(url);
      const cleanup = attachAudioEvents(element);
      audioCleanupRef.current = cleanup;
      element.addEventListener(
        "ended",
        () => {
          cleanup();
          audioCleanupRef.current = null;
          releaseAudioResources();
        },
        { once: true },
      );

      audioElementRef.current = element;
      return element;
    },
    [attachAudioEvents, loadTts, releaseAudioResources, voice],
  );

  const playChapter = useCallback(async () => {
    const chapterToPlay = activeChapter;
    if (!chapterToPlay) {
      setError("Select a chapter to start listening.");
      return;
    }

    setError(null);

    try {
      if (
        audioElementRef.current &&
        activeChapterForAudio.current === chapterToPlay.id
      ) {
        await audioElementRef.current.play();
        return;
      }

      releaseAudioResources();
      setPlaybackState("loading");

      const audio = await generateAudioForChapter(chapterToPlay.plainText);
      activeChapterForAudio.current = chapterToPlay.id;
      await audio.play();
      setActiveView("player");
    } catch (err) {
      console.error(err);
      setPlaybackState("idle");
      setError(
        err instanceof Error ? err.message : "We couldn't start the audiobook.",
      );
    }
  }, [activeChapter, generateAudioForChapter, releaseAudioResources]);

  const pausePlayback = useCallback(() => {
    audioElementRef.current?.pause();
  }, []);

  const stopPlayback = useCallback(() => {
    releaseAudioResources();
  }, [releaseAudioResources]);

  const handleSeek = useCallback((value: number[]) => {
    if (!audioElementRef.current) return;
    const [nextTime] = value;
    audioElementRef.current.currentTime = nextTime;
  }, []);

  const handleSelectBook = useCallback(
    (bookId: string) => {
      const selectedBook = library.find((book) => book.id === bookId);
      setActiveBookId(bookId);
      setActiveChapterId(selectedBook?.chapters[0]?.id);
      releaseAudioResources();
    },
    [library, releaseAudioResources],
  );

  const handleSelectChapter = useCallback(
    (bookId: string, chapterId: string) => {
      setActiveBookId(bookId);
      setActiveChapterId(chapterId);
      if (
        activeChapterForAudio.current &&
        activeChapterForAudio.current !== chapterId
      ) {
        releaseAudioResources();
      }
      setActiveView("reader");
    },
    [releaseAudioResources],
  );

  const handleVoiceSelect = useCallback(
    (value: VoiceId) => {
      setVoice(value);
      if (audioElementRef.current && playbackState !== "idle") {
        releaseAudioResources();
      }
    },
    [playbackState, releaseAudioResources],
  );

  const ingestEpub = useCallback(
    async (params: {
      buffer: ArrayBuffer;
      sourcePath: string;
      fallbackTitle?: string;
    }) => {
      ensureEpubSignature(params.buffer);

      const epubBook = ePub(params.buffer);
      await epubBook.ready;

      const [metadata, navigation, spine, coverUrl] = await Promise.all([
        epubBook.loaded.metadata,
        epubBook.loaded.navigation.catch(() => undefined),
        epubBook.loaded.spine,
        epubBook
          .coverUrl()
          .catch(() => undefined)
          .then((url) => url || undefined),
      ]);

      const navMap = buildNavigationMap(navigation?.toc as NavItem[] | undefined);
      const newBookId = createId();

      const chapters = await Promise.all(
        spine.items.map(async (item, index) => {
          try {
            const rawHtml = await epubBook.load(item.href);
            const sanitized = sanitizeChapterHtml(rawHtml);
            const plainText = extractPlainText(sanitized);
            const lookupKey = item.href.split("#")[0];
            const title =
              navMap.get(lookupKey) ??
              item.label?.trim() ??
              `Section ${index + 1}`;

            return {
              id: `${newBookId}-${item.id ?? index}`,
              title,
              contentHtml: sanitized,
              plainText,
              order: index,
              href: item.href,
            } as Chapter;
          } catch (chapterError) {
            console.warn("Could not load chapter", chapterError);
            return null;
          }
        }),
      );

      const filteredChapters = chapters.filter(
        (chapter): chapter is Chapter =>
          Boolean(chapter && chapter.plainText.trim()),
      );

      if (!filteredChapters.length) {
        throw new Error(
          "We couldn't extract any readable chapters from this ebook.",
        );
      }

      const fallbackTitle =
        params.fallbackTitle ?? deriveTitleFromPath(params.sourcePath);

      const newBook: Book = {
        id: newBookId,
        title: metadata.title?.trim() || fallbackTitle,
        author: metadata.creator?.trim() || "Unknown author",
        chapters: filteredChapters,
        coverUrl,
        sourcePath: params.sourcePath,
      };

      setLibrary((prev) => [...prev, newBook]);
      setActiveBookId(newBook.id);
      setActiveChapterId(newBook.chapters[0]?.id);
      setActiveView("reader");
      releaseAudioResources();

    },
    [releaseAudioResources],
  );

  const handleAddEbook = useCallback(async () => {
    if (isImporting) return;

    const tauriAvailable = isTauriEnvironment();
    if (!tauriAvailable) {
      fileInputRef.current?.click();
      return;
    }

    try {
      setError(null);
      setIsImporting(true);

      const selection = await open({
        multiple: false,
        filters: [{ name: "EPUB files", extensions: ["epub"] }],
      });

      const filePath = Array.isArray(selection)
        ? selection[0]
        : selection ?? undefined;

      if (!filePath) return;

      if (!filePath.toLowerCase().endsWith(".epub")) {
        setError("Please choose an EPUB (.epub) file.");
        return;
      }

      if (library.some((book) => book.sourcePath === filePath)) {
        setError("This ebook is already in your library.");
        return;
      }

      const binary = await readFile(filePath);
      const arrayBuffer = binary.buffer.slice(
        binary.byteOffset,
        binary.byteOffset + binary.byteLength,
      );

      await ingestEpub({
        buffer: arrayBuffer,
        sourcePath: filePath,
      });
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while importing that ebook.",
      );
    } finally {
      setIsImporting(false);
    }
  }, [ingestEpub, isImporting, library]);

  const handleWebFileSelection = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      if (file.type && file.type !== "application/epub+zip") {
        setError("Please choose an EPUB file.");
        return;
      }

      if (!file.name.toLowerCase().endsWith(".epub")) {
        setError("Please choose an EPUB (.epub) file.");
        return;
      }

      const sourceKey = `web://${file.name}:${file.size}:${file.lastModified}`;

      if (library.some((book) => book.sourcePath === sourceKey)) {
        setError("This ebook is already in your library.");
        return;
      }

      setIsImporting(true);
      setError(null);

      try {
        const buffer = await file.arrayBuffer();
        await ingestEpub({
          buffer,
          sourcePath: sourceKey,
          fallbackTitle: file.name,
        });
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong while importing that ebook.",
        );
      } finally {
        setIsImporting(false);
      }
    },
    [ingestEpub, library],
  );

  const libraryView = (
    <LibraryPanel
      library={library}
      activeBookId={activeBookId}
      activeChapterId={activeChapterId}
      isImporting={isImporting}
      onAddEbook={handleAddEbook}
      onSelectBook={handleSelectBook}
      onSelectChapter={handleSelectChapter}
    />
  );

  const playbackView = (
    <PlaybackPanel
      activeBook={activeBook}
      activeChapter={activeChapter}
      playbackState={playbackState}
      isLoadingModel={isLoadingModel}
      isImporting={isImporting}
      voice={voice}
      voices={VOICE_OPTIONS}
      progress={progress}
      duration={duration}
      error={error}
      onPlay={playChapter}
      onPause={pausePlayback}
      onStop={stopPlayback}
      onSeek={handleSeek}
      onSelectVoice={handleVoiceSelect}
    />
  );

  const readerView = (
    <ReaderPanel activeBook={activeBook} activeChapter={activeChapter} />
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <HiddenFileInput
        ref={fileInputRef}
        accept=".epub,application/epub+zip"
        aria-label="Select an EPUB file to import"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleWebFileSelection}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Headphones className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Whisperleaf Reader
            </h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            Import any EPUB, browse its chapters, and let Whisperleaf narrate
            every page. Designed for focused reading on desktop and a tab-first
            experience on mobile.
          </p>
        </header>

        <MobileNavigation
          activeView={activeView}
          onChange={setActiveView}
          librarySlot={libraryView}
          readerSlot={readerView}
          playerSlot={playbackView}
        />

        <div className="hidden gap-6 lg:grid lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="space-y-6">{libraryView}</div>
          <div className="flex flex-col gap-6">
            {playbackView}
            {readerView}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
