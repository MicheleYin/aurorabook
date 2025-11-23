import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import DOMPurify from "dompurify";
import ePub from "epubjs";
import { toast } from "sonner";

import { HiddenFileInput } from "./components/HiddenFileInput";
import { LibraryPanel } from "./components/LibraryPanel";
import { ReaderPanel } from "./components/ReaderPanel";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import type {
  Book,
  Chapter,
  NavItem,
  ReaderPreferences,
} from "./types/reader";

const sharedTextDecoder =
  typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
const sharedXmlSerializer =
  typeof XMLSerializer !== "undefined" ? new XMLSerializer() : null;

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

const decodeBufferToString = (value: ArrayBuffer | ArrayBufferView): string => {
  if (!sharedTextDecoder) {
    return "";
  }

  const view =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer)
          : undefined;

  if (!view) {
    return "";
  }

  return sharedTextDecoder.decode(view);
};

const normalizeChapterContent = async (content: unknown): Promise<string> => {
  if (typeof content === "string") {
    return content;
  }

  if (content instanceof Blob) {
    return await content.text();
  }

  if (content instanceof ArrayBuffer) {
    return decodeBufferToString(content);
  }

  if (ArrayBuffer.isView(content)) {
    return decodeBufferToString(content);
  }

  if (
    typeof content === "object" &&
    content !== null &&
    "buffer" in content &&
    content.buffer instanceof ArrayBuffer
  ) {
    return decodeBufferToString(
      ArrayBuffer.isView(content) ? content : new Uint8Array(content.buffer),
    );
  }

  if (
    typeof Document !== "undefined" &&
    content instanceof Document &&
    sharedXmlSerializer
  ) {
    return sharedXmlSerializer.serializeToString(content);
  }

  if (
    typeof Element !== "undefined" &&
    content instanceof Element &&
    sharedXmlSerializer
  ) {
    return sharedXmlSerializer.serializeToString(content);
  }

  if (
    typeof content === "object" &&
    content !== null &&
    "textContent" in content &&
    typeof (content as { textContent: unknown }).textContent === "string"
  ) {
    return (content as { textContent: string }).textContent;
  }

  console.warn(
    "Unexpected chapter content type received from EPUB spine:",
    content,
  );
  return "";
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

const sanitizeChapterHtml = (html: string) => {
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

const extractPlainText = (html: string) => {
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
  const [activeView, setActiveView] = useState<"library" | "reader">("library");
  const [isImporting, setIsImporting] = useState(false);
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>({
    theme: "light",
    fontFamily: "merriweather",
  });
  const [pendingFragment, setPendingFragment] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeBook = useMemo(() => {
    if (!activeBookId) return undefined;
    return library.find((book) => book.id === activeBookId);
  }, [library, activeBookId]);

  const activeChapter = useMemo(() => {
    if (!activeBook || !activeChapterId) return undefined;
    return activeBook.chapters.find((chapter) => chapter.id === activeChapterId);
  }, [activeBook, activeChapterId]);

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

  const updateReaderPreferences = useCallback(
    (update: Partial<ReaderPreferences>) => {
      setReaderPreferences((prev: ReaderPreferences) => ({
        ...prev,
        ...update,
      }));
    },
    [],
  );

  const handleFragmentConsumed = useCallback(() => {
    setPendingFragment(null);
  }, []);

  const handleSelectBook = useCallback(
    (bookId: string) => {
      const selectedBook = library.find((book) => book.id === bookId);
      setActiveBookId(bookId);
      setActiveChapterId(selectedBook?.chapters[0]?.id);
      setPendingFragment(null);
      setActiveView("reader");
    },
    [library],
  );

  const handleSelectChapter = useCallback(
    (chapterId: string, fragment?: string) => {
      if (!activeBookId) return;
      setActiveChapterId(chapterId);
      setPendingFragment(fragment && fragment.length > 0 ? fragment : null);
      setActiveView("reader");
    },
    [activeBookId],
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
            const normalizedHtml = await normalizeChapterContent(rawHtml);
            if (!normalizedHtml) {
              return null;
            }

            const sanitized = sanitizeChapterHtml(normalizedHtml);
            if (!sanitized.trim()) {
              return null;
            }

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
    },
    [],
  );

  const handleAddEbook = useCallback(async () => {
    if (isImporting) return;

    const tauriAvailable = isTauriEnvironment();
    if (!tauriAvailable) {
      fileInputRef.current?.click();
      return;
    }

    try {
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
        toast.error("Please choose an EPUB (.epub) file.");
        return;
      }

      if (library.some((book) => book.sourcePath === filePath)) {
        toast.error("This ebook is already in your library.");
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
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong while importing that ebook.";
      toast.error(message);
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
        toast.error("Please choose an EPUB file.");
        return;
      }

      if (!file.name.toLowerCase().endsWith(".epub")) {
        toast.error("Please choose an EPUB (.epub) file.");
        return;
      }

      const sourceKey = `web://${file.name}:${file.size}:${file.lastModified}`;

      if (library.some((book) => book.sourcePath === sourceKey)) {
        toast.error("This ebook is already in your library.");
        return;
      }

      setIsImporting(true);

      try {
        const buffer = await file.arrayBuffer();
        await ingestEpub({
          buffer,
          sourcePath: sourceKey,
          fallbackTitle: file.name,
        });
      } catch (err) {
        console.error(err);
        const message =
          err instanceof Error
            ? err.message
            : "Something went wrong while importing that ebook.";
        toast.error(message);
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
      isImporting={isImporting}
      onAddEbook={handleAddEbook}
      onOpenBook={handleSelectBook}
    />
  );

  const readerView = (
    <ReaderPanel
      activeBook={activeBook}
      activeChapter={activeChapter}
      preferences={readerPreferences}
      onPreferencesChange={updateReaderPreferences}
      onSelectChapter={handleSelectChapter}
      pendingFragment={pendingFragment}
      onFragmentConsumed={handleFragmentConsumed}
    />
  );

  useEffect(() => {
    if (!library.length) {
      setActiveView("library");
    }
  }, [library.length]);

  const isLibraryView = activeView === "library";

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
        {/* Header removed per redesign */}

        <div className="flex-1 space-y-6">
          {isLibraryView ? (
            <div className="flex flex-col">{libraryView}</div>
          ) : (
            <div className="space-y-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => setActiveView("library")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to library
              </Button>
              {readerView}
            </div>
          )}
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
