/**
 * Conversion State Context
 *
 * Manages book conversion (TTS / EPUB→audiobook) progress and actions. Registers Tauri
 * `listen` handlers on this provider (same lifecycle model as `AudioExportStateContext`)
 * so progress updates are not mediated by a separate event hub or child components.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import { Estimation } from "arrival-time";
import humanizeDuration from "humanize-duration";
import { toast } from "sonner";

import { Book } from "@/types/book";

import type { AppSettings } from "../types/settings";
import { logger } from "../lib/logger";
import { useTranslation } from "../lib/i18n";
import { humanizeDurationLocale } from "../constants/languages";
import { dismissLoadingToast } from "../lib/toast-utils";

export interface ConversionProgress {
  currentChapter: number;
  totalChapters: number;
  wordsProcessed: number;
  totalWords: number;
  wordsInCurrentChapter: number;
  currentStep: string;
  message: string;
}

interface ContinuedConversionStart {
  jobId: string;
  taskId: string;
  bookId: string;
  continuedProcessing: boolean;
}

interface BackgroundCapabilities {
  supportsContinuedProcessing: boolean;
  isIos: boolean;
}

interface BackgroundJobLifecycle {
  jobId: string;
  taskId: string;
  bookId: string;
  success?: boolean | null;
}

interface ChapterCompletedEvent {
  bookId: string;
  sourcePath: string;
  chapterIndex: number;
  totalChapters: number;
  chapterTitle: string;
  audioGenerated: boolean;
}

interface ConversionCancelledEvent {
  bookId: string;
  sourcePath: string;
}

export interface ConversionStateCallbacks {
  onConversionComplete?: (
    book: Book | null,
    bookId?: string | null
  ) => Promise<void> | void;
  onConversionStarted?: (bookId: string | null) => Promise<void> | void;
  onConversionCancelled?: (bookId: string | null) => Promise<void> | void;
  onChapterCompleted?: (bookId: string | null) => Promise<void> | void;
}

interface ConversionStateContextValue {
  isConverting: boolean;
  convertingBookId: string | null;
  conversionProgress: ConversionProgress | null;
  currentConvertingChapterByBook: Record<string, number | null>;
  getCurrentConvertingChapter: (bookId: string) => number | null;
  refreshCurrentConvertingChapter: (bookId: string) => Promise<number | null>;
  eta: string | null; // Estimated time remaining (e.g., "5m 30s")
  convertBook: (bookId: string, language?: string, voiceId?: string) => Promise<void>;
  cancelConversion: (bookId: string | null) => Promise<void>;
  registerCallbacks: (callbacks: ConversionStateCallbacks) => () => void;
}

const ConversionStateContext =
  createContext<ConversionStateContextValue | null>(null);

interface ConversionStateProviderProps {
  children: ReactNode;
}

export function ConversionStateProvider({
  children,
}: Readonly<ConversionStateProviderProps>) {
  const { lang } = useTranslation();
  const [isConverting, setIsConverting] = useState(false);
  const [convertingBookId, setConvertingBookId] = useState<string | null>(null);
  const [progressToastId, setProgressToastId] = useState<string | null>(null);
  const [conversionProgress, setConversionProgress] =
    useState<ConversionProgress | null>(null);
  const [currentConvertingChapterByBook, setCurrentConvertingChapterByBook] =
    useState<Record<string, number | null>>({});
  const [eta, setEta] = useState<string | null>(null);

  // Use refs to track current state without causing re-renders
  const progressToastIdRef = useRef<string | null>(null);
  const convertingBookIdRef = useRef<string | null>(null);
  const chapterToastIdRef = useRef<string | null>(null);
  const completedBookIdRef = useRef<string | null>(null);
  const [estimation, setEstimation] = useState<Estimation | null>(null);
  const estimationRef = useRef<Estimation | null>(null);

  // Store registered callbacks
  const callbacksRef = useRef<Set<ConversionStateCallbacks>>(new Set());

  useEffect(() => {
    estimationRef.current = estimation;
  }, [estimation]);

  // Update refs when values change
  useEffect(() => {
    progressToastIdRef.current = progressToastId;
    convertingBookIdRef.current = convertingBookId;
  }, [progressToastId, convertingBookId]);

  const getCurrentConvertingChapter = useCallback(
    (bookId: string) => {
      if (!bookId) return null;
      return currentConvertingChapterByBook[bookId] ?? null;
    },
    [currentConvertingChapterByBook]
  );

  const refreshCurrentConvertingChapter = useCallback(async (bookId: string) => {
    if (!bookId) return null;

    try {
      const chapter = await invoke<number | null>("get_current_converting_chapter", {
        bookId,
      });

      logger.info("[conversion-state] fetched live chapter", {
        bookId,
        chapter,
      });

      setCurrentConvertingChapterByBook((prev) => {
        if ((prev[bookId] ?? null) === chapter) {
          return prev;
        }

        logger.info("[conversion-state] updated live chapter", {
          bookId,
          previousChapter: prev[bookId] ?? null,
          nextChapter: chapter,
          source: "refreshCurrentConvertingChapter",
        });

        return {
          ...prev,
          [bookId]: chapter,
        };
      });

      return chapter;
    } catch (err) {
      logger.warn("Failed to refresh current converting chapter:", err);
      return null;
    }
  }, []);

  const handleConversionComplete = useCallback(
    (book: Book | null, bookId?: string | null) => {
      const completedBookId = bookId ?? book?.id ?? convertingBookIdRef.current;

      if (!completedBookId) {
        logger.error("Received conversion completion without a book ID");
        return;
      }

      if (completedBookIdRef.current === completedBookId) {
        logger.log("Ignoring duplicate conversion completion", completedBookId);
        return;
      }

      completedBookIdRef.current = completedBookId;

      const toastId =
        progressToastIdRef.current ?? `conversion-${completedBookId}`;

      toast.success("Conversion complete!", { id: toastId });
      dismissLoadingToast(toastId);
      setIsConverting(false);
      setConvertingBookId(null);
      setProgressToastId(null);
      setConversionProgress(null);
      setEta(null);
      setEstimation(null);
      progressToastIdRef.current = null;
      convertingBookIdRef.current = null;
      chapterToastIdRef.current = null;
      estimationRef.current = null;
      setCurrentConvertingChapterByBook((prev) => ({
        ...prev,
        [completedBookId]: null,
      }));

      callbacksRef.current.forEach((callbacks) => {
        try {
          callbacks.onConversionComplete?.(book, completedBookId);
        } catch (error) {
          logger.error("Error in onConversionComplete callback:", error);
        }
      });
    },
    []
  );

  // Tauri listeners live on the provider (same pattern as AudioExportStateContext) so progress
  // is not tied to a pub/sub layer or child lifecycle.
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      try {
        const unProgress = await listen<ConversionProgress>(
          "conversion-progress",
          (event) => {
            if (disposed) return;
            const progress = event.payload;
            const percent =
              progress.totalWords > 0
                ? Math.round(
                    (progress.wordsProcessed / progress.totalWords) * 100
                  )
                : 0;

            const measurement = estimationRef.current?.update(
              progress.wordsProcessed,
              progress.totalWords
            );

            setEta(
              humanizeDuration(measurement?.estimate ?? 0, {
                round: true,
                language: humanizeDurationLocale(lang),
              })
            );

            setConversionProgress(progress);

            const activeBookId = convertingBookIdRef.current;
            if (activeBookId) {
              const chapterIndex =
                progress.totalChapters > 0
                  ? Math.max(
                      0,
                      Math.min(
                        progress.totalChapters - 1,
                        progress.currentChapter - 1
                      )
                    )
                  : null;

              if (chapterIndex !== null) {
                setCurrentConvertingChapterByBook((prev) => {
                  const previousChapter = prev[activeBookId] ?? null;

                  if (previousChapter === chapterIndex) {
                    return prev;
                  }

                  // Ignore backward jumps from noisy/relative progress payloads.
                  if (
                    previousChapter !== null &&
                    chapterIndex < previousChapter &&
                    progress.currentStep !== "skipping"
                  ) {
                    return prev;
                  }

                  return {
                    ...prev,
                    [activeBookId]: chapterIndex,
                  };
                });
              }
            }

            const toastId =
              progressToastIdRef.current ??
              `conversion-${convertingBookIdRef.current}`;
            if (
              progressToastIdRef.current === null &&
              convertingBookIdRef.current
            ) {
              setProgressToastId(toastId);
              progressToastIdRef.current = toastId;
            }

            if (
              progress.currentChapter >= progress.totalChapters &&
              percent >= 100
            ) {
              handleConversionComplete(null, convertingBookIdRef.current);
            }
          }
        );
        unlisteners.push(unProgress);

        const unChapter = await listen<ChapterCompletedEvent>(
          "chapter-completed",
          (event) => {
            if (disposed) return;
            const { bookId, chapterTitle, chapterIndex, totalChapters } =
              event.payload;
            logger.log("Chapter completed:", event.payload);

            if (bookId && convertingBookIdRef.current === bookId) {
              const optimisticNextChapter =
                chapterIndex < totalChapters ? chapterIndex : null;

              setCurrentConvertingChapterByBook((prev) => ({
                ...prev,
                [bookId]: optimisticNextChapter,
              }));

              void refreshCurrentConvertingChapter(bookId);
            }

            const chapterToastId = `chapter-completed-${bookId}`;
            chapterToastIdRef.current = chapterToastId;

            toast.success(
              `Chapter ${chapterIndex}/${totalChapters} completed: ${chapterTitle}`,
              {
                id: chapterToastId,
                duration: 3000,
              }
            );

            callbacksRef.current.forEach((callbacks) => {
              try {
                callbacks.onChapterCompleted?.(bookId);
              } catch (error) {
                logger.error("Error in onChapterCompleted callback:", error);
              }
            });
          }
        );
        unlisteners.push(unChapter);

        const unCancelled = await listen<ConversionCancelledEvent>(
          "conversion-cancelled",
          (event) => {
            if (disposed) return;
            const { bookId } = event.payload;
            const toastId = progressToastIdRef.current;
            if (toastId) {
              toast.error("Conversion cancelled", { id: toastId });
              dismissLoadingToast(toastId);
            } else {
              toast.error("Conversion cancelled");
            }
            setIsConverting(false);
            setConvertingBookId(null);
            setProgressToastId(null);
            setConversionProgress(null);
            setEta(null);
            progressToastIdRef.current = null;
            convertingBookIdRef.current = null;
            chapterToastIdRef.current = null;
            completedBookIdRef.current = null;
            setEstimation(null);
            estimationRef.current = null;
            if (bookId) {
              setCurrentConvertingChapterByBook((prev) => ({
                ...prev,
                [bookId]: null,
              }));
            }

            callbacksRef.current.forEach((callbacks) => {
              try {
                callbacks.onConversionCancelled?.(bookId);
              } catch (error) {
                logger.error("Error in onConversionCancelled callback:", error);
              }
            });
          }
        );
        unlisteners.push(unCancelled);

        const unBgExpired = await listen<BackgroundJobLifecycle>(
          "background-task-expired",
          (event) => {
            if (disposed) return;
            logger.warn("Background conversion task expired:", event.payload);
            toast.info(
              "Background conversion was stopped by the system. Re-open the app to continue.",
              { duration: 5000 }
            );
          }
        );
        unlisteners.push(unBgExpired);

        const unBgCompleted = await listen<BackgroundJobLifecycle>(
          "background-task-completed",
          (event) => {
            if (disposed) return;
            logger.log("Background conversion task completed:", event.payload);
          }
        );
        unlisteners.push(unBgCompleted);
      } catch (error) {
        logger.error("Failed to register conversion Tauri event listeners:", error);
      }
    };

    void setup();

    return () => {
      disposed = true;
      for (const u of unlisteners) {
        try {
          u();
        } catch (e) {
          logger.error("Error while unlistening conversion event:", e);
        }
      }
    };
  }, [handleConversionComplete, lang, refreshCurrentConvertingChapter]);

  const convertBook = useCallback(
    async (bookId: string, language?: string, voiceId?: string) => {
      // Prevent duplicate conversions
      if (isConverting && convertingBookId === bookId) {
        logger.log("Conversion already in progress for this book");
        return;
      }

      try {
        setIsConverting(true);
        setConvertingBookId(bookId);
        convertingBookIdRef.current = bookId;
        const toastId = `conversion-${bookId}`;
        setProgressToastId(toastId);
        progressToastIdRef.current = toastId;
        completedBookIdRef.current = null;
        setEstimation(new Estimation());
        setEta(null);

        setCurrentConvertingChapterByBook((prev) => ({
          ...prev,
          [bookId]: prev[bookId] ?? null,
        }));
        void refreshCurrentConvertingChapter(bookId);

        // Call registered callbacks for conversion started
        callbacksRef.current.forEach((callbacks) => {
          try {
            callbacks.onConversionStarted?.(bookId);
          } catch (error) {
            logger.error("Error in onConversionStarted callback:", error);
          }
        });

        // Get the current voice and language from settings if not provided
        const settings = await invoke<AppSettings>("get_app_settings");
        const finalVoiceId = voiceId ?? settings.ttsVoiceId ?? "F1";
        const finalLanguage = language ?? settings.ttsLanguage ?? "en";

        // iOS 26+: submit BGContinuedProcessingTaskRequest on user gesture before TTS load.
        let continuedTaskId: string | null = null;
        try {
          const platform = await type();
          if (platform === "ios") {
            const caps = await invoke<BackgroundCapabilities>(
              "background_capabilities"
            );
            if (caps.supportsContinuedProcessing) {
              const started = await invoke<ContinuedConversionStart>(
                "start_continued_conversion",
                {
                  bookId,
                  title: "Converting audiobook",
                  subtitle: "AuroraBook",
                }
              );
              continuedTaskId = started.taskId;
              if (started.continuedProcessing) {
                logger.log(
                  "Submitted continued conversion task:",
                  started.taskId
                );
                toast.message(
                  "Leave the app to see conversion progress on Lock Screen or Dynamic Island (iPhone often hides it while AuroraBook is open).",
                  { duration: 5000 }
                );
              }
            } else {
              logger.warn(
                "Continued processing not supported (need iOS 26+). Caps:",
                caps
              );
            }
          }
        } catch (bgErr) {
          // Fall through to in-process conversion; older iOS / simulators may not support this.
          logger.warn(
            "Continued background conversion unavailable; converting in-process:",
            bgErr
          );
        }

        const book = await invoke<Book | null>(
          "convert_epub_to_audiobook_command",
          {
            bookId,
            voiceId: finalVoiceId,
            language: finalLanguage,
          }
        );

        // If conversion completes immediately (book is returned), call the complete callback
        if (book) {
          handleConversionComplete(book, bookId);
        }

        void continuedTaskId;
        // Don't dismiss the toast here - let the progress events handle it
        // The conversion might complete immediately or continue in background
      } catch (err) {
        logger.error("Failed to convert book:", err);
        const toastId = progressToastId || progressToastIdRef.current;
        if (toastId) {
          toast.error(
            err instanceof Error ? err.message : "Failed to convert book",
            { id: toastId }
          );
          dismissLoadingToast(toastId);
        } else {
          toast.error(
            err instanceof Error ? err.message : "Failed to convert book"
          );
        }
        setIsConverting(false);
        setConvertingBookId(null);
        setProgressToastId(null);
        setConversionProgress(null);
        setEta(null);
        progressToastIdRef.current = null;
        convertingBookIdRef.current = null;
        chapterToastIdRef.current = null;
        completedBookIdRef.current = null;
        setEstimation(null);
        estimationRef.current = null;
      }
    },
    [
      handleConversionComplete,
      progressToastId,
      isConverting,
      convertingBookId,
      refreshCurrentConvertingChapter,
    ]
  );

  const cancelConversion = useCallback(async (bookId: string | null) => {
    if (!bookId) return;
    try {
      await invoke("cancel_conversion_command", {
        bookId,
      });
      toast.info("Cancellation requested...");
    } catch (err) {
      logger.error("Failed to cancel conversion:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel conversion"
      );
    }
  }, []);

  // Register callbacks for conversion events
  const registerCallbacks = useCallback(
    (callbacks: ConversionStateCallbacks) => {
      callbacksRef.current.add(callbacks);
      logger.log(
        `Registered conversion callbacks (${callbacksRef.current.size} total)`
      );

      // Return unregister function
      return () => {
        callbacksRef.current.delete(callbacks);
        logger.log(
          `Unregistered conversion callbacks (${callbacksRef.current.size} remaining)`
        );
      };
    },
    []
  );

  const value: ConversionStateContextValue = useMemo(
    () => ({
      isConverting,
      convertingBookId,
      conversionProgress,
      currentConvertingChapterByBook,
      getCurrentConvertingChapter,
      refreshCurrentConvertingChapter,
      eta,
      convertBook,
      cancelConversion,
      registerCallbacks,
    }),
    [
      isConverting,
      convertingBookId,
      conversionProgress,
      currentConvertingChapterByBook,
      getCurrentConvertingChapter,
      refreshCurrentConvertingChapter,
      eta,
      convertBook,
      cancelConversion,
      registerCallbacks,
    ]
  );

  return (
    <ConversionStateContext.Provider value={value}>
      {children}
    </ConversionStateContext.Provider>
  );
}

export function useConversionState() {
  const context = useContext(ConversionStateContext);
  if (!context) {
    throw new Error(
      "useConversionState must be used within a ConversionStateProvider"
    );
  }
  return context;
}
