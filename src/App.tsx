import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Headphones, Pause, Play, Square } from "lucide-react";
import { KokoroTTS } from "kokoro-js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Button } from "./components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./components/ui/tabs";
import { ScrollArea } from "./components/ui/scroll-area";
import { Slider } from "./components/ui/slider";
import { cn } from "./lib/utils";
import { library } from "./data/library";

type PlaybackState = "idle" | "loading" | "playing" | "paused";

type Book = (typeof library)[number];

const DEFAULT_BOOK_ID = library[0]?.id;
const DEFAULT_CHAPTER_ID = library[0]?.chapters[0]?.id;

const VOICE_OPTIONS = [
  { label: "Heart", value: "af_heart" },
  { label: "Alloy", value: "en_alloy" },
  { label: "Verse", value: "en_verse" },
];

const MAX_CHAPTER_CHARACTERS = 4000;

function App() {
  const [activeBookId, setActiveBookId] = useState<string | undefined>(
    DEFAULT_BOOK_ID,
  );
  const [activeChapterId, setActiveChapterId] = useState<string | undefined>(
    DEFAULT_CHAPTER_ID,
  );
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [voice, setVoice] = useState(VOICE_OPTIONS[0]?.value ?? "af_heart");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const ttsRef = useRef<KokoroTTS | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const activeChapterForAudio = useRef<string | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);

  const activeBook = useMemo<Book | undefined>(() => {
    return library.find((book) => book.id === activeBookId);
  }, [activeBookId]);

  const activeChapter = useMemo(() => {
    return activeBook?.chapters.find((chapter) => chapter.id === activeChapterId);
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
      // Avoid flipping to paused when playback finishes.
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

      const audio = await generateAudioForChapter(chapterToPlay.content);
      activeChapterForAudio.current = chapterToPlay.id;
      await audio.play();
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

  const handleSeek = useCallback(
    (value: number[]) => {
      if (!audioElementRef.current) return;
      const [nextTime] = value;
      audioElementRef.current.currentTime = nextTime;
    },
    [],
  );

  useEffect(() => {
    if (!activeBook) {
      setActiveChapterId(undefined);
      return;
    }

    if (!activeBook.chapters.some((chapter) => chapter.id === activeChapterId)) {
      setActiveChapterId(activeBook.chapters[0]?.id);
    }
  }, [activeBook, activeChapterId]);

  const readingMarkup = useMemo(() => {
    if (!activeChapter) return null;
    return activeChapter.content.split(/\n{2,}/).map((paragraph, index) => (
      <p key={index} className="leading-relaxed text-muted-foreground">
        {paragraph}
      </p>
    ));
  }, [activeChapter]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Headphones className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-semibold tracking-tight">
              Whisperleaf Reader
            </h1>
          </div>
          <p className="text-muted-foreground">
            Immerse yourself in beautiful prose while Whisperleaf narrates every
            chapter for you.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BookOpen className="h-5 w-5 text-primary" />
                Library
              </CardTitle>
              <CardDescription>
                Choose a story and jump to any chapter.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs
                value={activeBook?.id}
                onValueChange={(value) => {
                  setActiveBookId(value);
                }}
                className="w-full"
              >
                <TabsList className="w-full justify-start overflow-x-auto">
                  {library.map((book) => (
                    <TabsTrigger key={book.id} value={book.id}>
                      {book.title}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {library.map((book) => (
                  <TabsContent key={book.id} value={book.id}>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {book.author}
                      </p>
                      <ScrollArea className="h-64 rounded-md border">
                        <div className="space-y-1 p-2">
                          {book.chapters.map((chapter) => {
                            const isActive = chapter.id === activeChapterId;
                            return (
                              <Button
                                key={chapter.id}
                                variant={isActive ? "secondary" : "ghost"}
                                className={cn(
                                  "w-full justify-start text-sm",
                                  isActive && "font-medium",
                                )}
                                onClick={() => {
                                  setActiveBookId(book.id);
                                  setActiveChapterId(chapter.id);
                                  if (
                                    activeChapterForAudio.current &&
                                    activeChapterForAudio.current !== chapter.id
                                  ) {
                                    releaseAudioResources();
                                  }
                                }}
                              >
                                {chapter.title}
                              </Button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{activeBook?.title ?? "Select a book"}</CardTitle>
                <CardDescription>{activeBook?.author}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={playChapter}
                    disabled={
                      !activeChapter ||
                      playbackState === "loading" ||
                      isLoadingModel
                    }
                  >
                    {playbackState === "paused" ? (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        {playbackState === "loading" ? "Preparing…" : "Play"}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={pausePlayback}
                    disabled={playbackState !== "playing"}
                  >
                    <Pause className="mr-2 h-4 w-4" />
                    Pause
                  </Button>
                  <Button
                    variant="outline"
                    onClick={stopPlayback}
                    disabled={playbackState === "idle"}
                  >
                    <Square className="mr-2 h-4 w-4" />
                    Stop
                  </Button>
                </div>

                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    Voice
                  </p>
                  <div className="flex gap-2">
                    {VOICE_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        variant={voice === option.value ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => {
                          setVoice(option.value);
                          if (
                            audioElementRef.current &&
                            playbackState !== "idle"
                          ) {
                            releaseAudioResources();
                          }
                        }}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span>
                      {new Date(progress * 1000).toISOString().slice(14, 19)} /{" "}
                      {duration
                        ? new Date(duration * 1000)
                            .toISOString()
                            .slice(14, 19)
                        : "--:--"}
                    </span>
                  </div>
                  <Slider
                    max={duration || 1}
                    value={[Math.min(progress, duration || 0)]}
                    disabled={!duration || playbackState === "loading"}
                    step={0.5}
                    onValueChange={handleSeek}
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                {isLoadingModel && (
                  <p className="text-sm text-muted-foreground">
                    Loading narrator model…
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="h-[520px]">
              <CardHeader>
                <CardTitle>{activeChapter?.title ?? "Chapter"}</CardTitle>
                <CardDescription>
                  {activeBook ? `${activeBook.title} · ${activeBook.author}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-full">
                <ScrollArea className="h-full rounded-md border p-4">
                  <div className="prose prose-neutral max-w-none dark:prose-invert">
                    {readingMarkup ?? (
                      <p className="text-muted-foreground">
                        Select a chapter from the library to start reading.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
