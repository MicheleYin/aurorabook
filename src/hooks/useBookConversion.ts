import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { Book } from "@/types/book";

import type { AppSettings } from "../types/settings";
import { useConversionEvents } from "../context/ConversionEventContext";
import { logger } from "../lib/logger";
import { dismissLoadingToast, showLoadingToast } from "../lib/toast-utils";

interface UseBookConversionOptions {
  onConversionComplete?: (book: Book | null) => Promise<void>;
  onConversionStarted?: (bookId: string | null) => Promise<void>;
  onConversionCancelled?: (bookId: string | null) => Promise<void>;
  onChapterCompleted?: (bookId: string | null) => Promise<void>;
}

export function useBookConversion(options?: UseBookConversionOptions) {
  const [isConverting, setIsConverting] = useState(false);
  const [convertingBookId, setConvertingBookId] = useState<string | null>(null);
  const [defaultVoiceId, setDefaultVoiceId] = useState<string>("af_heart");
  const [progressToastId, setProgressToastId] = useState<string | null>(null);

  // Use refs to track current state without causing re-renders
  const progressToastIdRef = useRef<string | null>(null);
  const convertingBookIdRef = useRef<string | null>(null);
  const chapterToastIdRef = useRef<string | null>(null);
  const onConversionCompleteRef = useRef(options?.onConversionComplete);
  const onConversionStartedRef = useRef(options?.onConversionStarted);
  const onConversionCancelledRef = useRef(options?.onConversionCancelled);
  const onChapterCompletedRef = useRef(options?.onChapterCompleted);

  // Update refs when values change
  useEffect(() => {
    progressToastIdRef.current = progressToastId;
    convertingBookIdRef.current = convertingBookId;
  }, [progressToastId, convertingBookId]);

  useEffect(() => {
    onConversionCompleteRef.current = options?.onConversionComplete;
    onConversionStartedRef.current = options?.onConversionStarted;
    onConversionCancelledRef.current = options?.onConversionCancelled;
    onChapterCompletedRef.current = options?.onChapterCompleted;
  }, [
    options?.onConversionComplete,
    options?.onConversionStarted,
    options?.onConversionCancelled,
    options?.onChapterCompleted,
  ]);

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

  // Subscribe to conversion events - handlers can be reset by re-subscribing
  useEffect(() => {
    // Subscribe to progress events
    const unsubscribeProgress = subscribeToProgress((progress) => {
      const percent =
        progress.totalWords > 0
          ? Math.round((progress.wordsProcessed / progress.totalWords) * 100)
          : 0;

      const toastId =
        progressToastIdRef.current ||
        `conversion-${convertingBookIdRef.current}`;
      if (!progressToastIdRef.current && convertingBookIdRef.current) {
        setProgressToastId(toastId);
        progressToastIdRef.current = toastId;
      }

      // Check if conversion is complete
      if (progress.currentChapter >= progress.totalChapters && percent >= 100) {
        toast.success(`Conversion complete!`, { id: toastId });
        dismissLoadingToast(toastId);
        setIsConverting(false);
        setConvertingBookId(null);
        setProgressToastId(null);
        progressToastIdRef.current = null;
        convertingBookIdRef.current = null;
        chapterToastIdRef.current = null;
        // Note: onConversionComplete is called from convertBook when it has the Book object
      } else {
        showLoadingToast(
          `${progress.message}\nChapter ${progress.currentChapter}/${progress.totalChapters} - ${percent}%`,
          toastId
        );
      }
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
      // Refresh book metadata when a chapter is completed - use bookId from event
      onChapterCompletedRef.current?.(bookId);
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
      progressToastIdRef.current = null;
      convertingBookIdRef.current = null;
      chapterToastIdRef.current = null;
      // Call the cancellation callback with the bookId from the event
      onConversionCancelledRef.current?.(bookId);
    });

    // Cleanup subscriptions on unmount
    return () => {
      unsubscribeProgress();
      unsubscribeChapterCompleted();
      unsubscribeCancelled();
    };
  }, [subscribeToProgress, subscribeToChapterCompleted, subscribeToCancelled]); // Re-subscribe when handlers change (allows reset)

  const convertBook = useCallback(
    async (bookId: string, bookTitle: string) => {
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

        showLoadingToast(`Starting conversion of "${bookTitle}"...`, toastId);
        onConversionStartedRef.current?.(bookId);

        const book = await invoke<Book | null>(
          "convert_epub_to_audiobook_command",
          {
            bookId,
            voiceId: defaultVoiceId,
          }
        );

        options?.onConversionComplete?.(book);

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
        progressToastIdRef.current = null;
        convertingBookIdRef.current = null;
        chapterToastIdRef.current = null;
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
      onConversionCancelledRef.current?.(bookId);
    } catch (err) {
      logger.error("Failed to cancel conversion:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel conversion"
      );
    }
  }, []);

  return {
    convertBook,
    cancelConversion,

    isConverting,
    convertingBookId,
  };
}
