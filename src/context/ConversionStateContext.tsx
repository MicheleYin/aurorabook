/**
 * Conversion State Context
 *
 * Manages the state of book conversions (progress, status, etc.)
 * This state persists across tab changes and component unmounts.
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
import { toast } from "sonner";

import { Book } from "@/types/book";

import type { AppSettings } from "../types/settings";
import { logger } from "../lib/logger";
import { dismissLoadingToast } from "../lib/toast-utils";
import { useConversionEvents } from "./ConversionEventContext";

export interface ConversionProgress {
  currentChapter: number;
  totalChapters: number;
  wordsProcessed: number;
  totalWords: number;
  wordsInCurrentChapter: number;
  currentStep: string;
  message: string;
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
  eta: string | null; // Estimated time remaining (e.g., "5m 30s")
  convertBook: (bookId: string) => Promise<void>;
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
  const [isConverting, setIsConverting] = useState(false);
  const [convertingBookId, setConvertingBookId] = useState<string | null>(null);
  const [defaultVoiceId, setDefaultVoiceId] = useState<string>("af_heart");
  const [progressToastId, setProgressToastId] = useState<string | null>(null);
  const [conversionProgress, setConversionProgress] =
    useState<ConversionProgress | null>(null);
  const [eta, setEta] = useState<string | null>(null);

  // Use refs to track current state without causing re-renders
  const progressToastIdRef = useRef<string | null>(null);
  const convertingBookIdRef = useRef<string | null>(null);
  const chapterToastIdRef = useRef<string | null>(null);
  const conversionStartTimeRef = useRef<number | null>(null);
  const lastProgressUpdateRef = useRef<{
    time: number;
    wordsProcessed: number;
  } | null>(null);

  // Store registered callbacks
  const callbacksRef = useRef<Set<ConversionStateCallbacks>>(new Set());

  // Update refs when values change
  useEffect(() => {
    progressToastIdRef.current = progressToastId;
    convertingBookIdRef.current = convertingBookId;
  }, [progressToastId, convertingBookId]);

  // Load default voice from settings
  useEffect(() => {
    const loadDefaultVoice = async () => {
      try {
        const settings = await invoke<AppSettings>("get_app_settings");
        setDefaultVoiceId(settings.ttsVoiceId || "af_heart");
      } catch (err) {
        logger.error("Failed to load default voice:", err);
      }
    };
    loadDefaultVoice();
  }, []);

  const {
    subscribeToProgress,
    subscribeToChapterCompleted,
    subscribeToCancelled,
  } = useConversionEvents();

  // Helper function to format time duration
  const formatETA = useCallback((seconds: number): string => {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
  }, []);

  // Subscribe to conversion events - handlers can be reset by re-subscribing
  useEffect(() => {
    // Subscribe to progress events
    const unsubscribeProgress = subscribeToProgress((progress) => {
      const percent =
        progress.totalWords > 0
          ? Math.round((progress.wordsProcessed / progress.totalWords) * 100)
          : 0;

      // Track start time on first progress update
      const now = Date.now();
      conversionStartTimeRef.current ??= now;

      // Calculate ETA based on progress rate
      if (progress.totalWords > 0 && progress.wordsProcessed > 0) {
        const elapsed = (now - conversionStartTimeRef.current) / 1000; // seconds
        const wordsPerSecond = progress.wordsProcessed / elapsed;
        const remainingWords = progress.totalWords - progress.wordsProcessed;

        if (wordsPerSecond > 0) {
          const remainingSeconds = remainingWords / wordsPerSecond;
          setEta(formatETA(remainingSeconds));
        } else {
          setEta(null);
        }

        // Update last progress update for smoothing
        lastProgressUpdateRef.current = {
          time: now,
          wordsProcessed: progress.wordsProcessed,
        };
      } else {
        setEta(null);
      }

      // Update progress state for UI components
      setConversionProgress(progress);

      const toastId =
        progressToastIdRef.current ??
        `conversion-${convertingBookIdRef.current}`;
      if (progressToastIdRef.current === null && convertingBookIdRef.current) {
        setProgressToastId(toastId);
        progressToastIdRef.current = toastId;
      }

      // Check if conversion is complete
      if (progress.currentChapter >= progress.totalChapters && percent >= 100) {
        toast.success(`Conversion complete!`, { id: toastId });
        dismissLoadingToast(toastId);
        const completedBookId = convertingBookIdRef.current;
        setIsConverting(false);
        setConvertingBookId(null);
        setProgressToastId(null);
        setConversionProgress(null);
        setEta(null);
        progressToastIdRef.current = null;
        convertingBookIdRef.current = null;
        chapterToastIdRef.current = null;
        conversionStartTimeRef.current = null;
        lastProgressUpdateRef.current = null;

        // Call registered callbacks for conversion complete
        // Note: We don't have the Book object here, so we pass null with the bookId
        // Components should refresh the book themselves using the bookId
        callbacksRef.current.forEach((callbacks) => {
          try {
            callbacks.onConversionComplete?.(null, completedBookId);
          } catch (error) {
            logger.error("Error in onConversionComplete callback:", error);
          }
        });
      }
      // Removed progress toast - progress is now shown in cards
    });

    // Subscribe to chapter completed events
    const unsubscribeChapterCompleted = subscribeToChapterCompleted((event) => {
      const { bookId, chapterTitle, chapterIndex, totalChapters } = event;
      logger.log("Chapter completed:", event);

      // Use a consistent toast ID to prevent duplicates - replace previous chapter toast
      const chapterToastId = `chapter-completed-${bookId}`;
      chapterToastIdRef.current = chapterToastId;

      toast.success(
        `Chapter ${chapterIndex}/${totalChapters} completed: ${chapterTitle}`,
        {
          id: chapterToastId,
          duration: 3000,
        }
      );

      // Call registered callbacks for chapter completed
      callbacksRef.current.forEach((callbacks) => {
        try {
          callbacks.onChapterCompleted?.(bookId);
        } catch (error) {
          logger.error("Error in onChapterCompleted callback:", error);
        }
      });
    });

    // Subscribe to cancelled events
    const unsubscribeCancelled = subscribeToCancelled((event) => {
      const { bookId } = event;
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
      conversionStartTimeRef.current = null;
      lastProgressUpdateRef.current = null;

      // Call registered callbacks for conversion cancelled
      callbacksRef.current.forEach((callbacks) => {
        try {
          callbacks.onConversionCancelled?.(bookId);
        } catch (error) {
          logger.error("Error in onConversionCancelled callback:", error);
        }
      });
    });

    // Cleanup subscriptions on unmount
    return () => {
      unsubscribeProgress();
      unsubscribeChapterCompleted();
      unsubscribeCancelled();
    };
  }, [
    subscribeToProgress,
    subscribeToChapterCompleted,
    subscribeToCancelled,
    formatETA,
  ]);

  const convertBook = useCallback(
    async (bookId: string) => {
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
        conversionStartTimeRef.current = Date.now();
        lastProgressUpdateRef.current = null;
        setEta(null);

        // Call registered callbacks for conversion started
        callbacksRef.current.forEach((callbacks) => {
          try {
            callbacks.onConversionStarted?.(bookId);
          } catch (error) {
            logger.error("Error in onConversionStarted callback:", error);
          }
        });

        const book = await invoke<Book | null>(
          "convert_epub_to_audiobook_command",
          {
            bookId,
            voiceId: defaultVoiceId,
          }
        );

        // If conversion completes immediately (book is returned), call the complete callback
        if (book) {
          callbacksRef.current.forEach((callbacks) => {
            try {
              callbacks.onConversionComplete?.(book, bookId);
            } catch (error) {
              logger.error("Error in onConversionComplete callback:", error);
            }
          });
        }

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
        conversionStartTimeRef.current = null;
        lastProgressUpdateRef.current = null;
      }
    },
    [defaultVoiceId, progressToastId, isConverting, convertingBookId]
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
      eta,
      convertBook,
      cancelConversion,
      registerCallbacks,
    }),
    [
      isConverting,
      convertingBookId,
      conversionProgress,
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
