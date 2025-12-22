import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import type { AppSettings } from "../types/settings";

interface ConversionProgress {
  currentChapter: number;
  totalChapters: number;
  wordsProcessed: number;
  totalWords: number;
  wordsInCurrentChapter: number;
  currentStep: string;
  message: string;
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

interface UseBookConversionOptions {
  onConversionComplete?: (bookId: string | null) => Promise<void>;
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
        console.error("Failed to load default voice:", err);
      }
    };
    loadDefaultVoice();
  }, []);

  // Listen for conversion progress events - set up once
  useEffect(() => {
    let progressUnlisten: (() => void) | null = null;
    let chapterCompletedUnlisten: (() => void) | null = null;
    let cancelledUnlisten: (() => void) | null = null;

    const setupListeners = async () => {
      progressUnlisten = await listen<ConversionProgress>(
        "conversion-progress",
        (event) => {
          const progress = event.payload;
          const percent =
            progress.totalWords > 0
              ? Math.round(
                  (progress.wordsProcessed / progress.totalWords) * 100
                )
              : 0;

          const toastId =
            progressToastIdRef.current ||
            `conversion-${convertingBookIdRef.current}`;
          if (!progressToastIdRef.current && convertingBookIdRef.current) {
            setProgressToastId(toastId);
            progressToastIdRef.current = toastId;
          }

          // Check if conversion is complete
          if (
            progress.currentChapter >= progress.totalChapters &&
            percent >= 100
          ) {
            toast.success(`Conversion complete!`, { id: toastId });
            setIsConverting(false);
            setConvertingBookId(null);
            setProgressToastId(null);
            progressToastIdRef.current = null;
            convertingBookIdRef.current = null;
            onConversionCompleteRef.current?.(convertingBookIdRef.current);
          } else {
            toast.loading(
              `${progress.message}\nChapter ${progress.currentChapter}/${progress.totalChapters} - ${percent}%`,
              { id: toastId }
            );
          }
        }
      );

      chapterCompletedUnlisten = await listen<ChapterCompletedEvent>(
        "chapter-completed",
        (event) => {
          const { bookId, chapterTitle, chapterIndex, totalChapters } =
            event.payload;
          console.log("Chapter completed:", event.payload);
          toast.success(
            `Chapter ${chapterIndex}/${totalChapters} completed: ${chapterTitle}`,
            { duration: 3000 }
          );
          // Refresh book metadata when a chapter is completed - use bookId from event
          onChapterCompletedRef.current?.(bookId);
        }
      );

      cancelledUnlisten = await listen<ConversionCancelledEvent>(
        "conversion-cancelled",
        (event) => {
          const { bookId } = event.payload;
          const toastId = progressToastIdRef.current;
          toast.error("Conversion cancelled", { id: toastId || undefined });
          setIsConverting(false);
          setConvertingBookId(null);
          setProgressToastId(null);
          progressToastIdRef.current = null;
          convertingBookIdRef.current = null;
          // Call the cancellation callback with the bookId from the event
          onConversionCancelledRef.current?.(bookId);
        }
      );
    };

    setupListeners();

    return () => {
      if (progressUnlisten) progressUnlisten();
      if (chapterCompletedUnlisten) chapterCompletedUnlisten();
      if (cancelledUnlisten) cancelledUnlisten();
    };
  }, []); // Empty deps - set up listeners only once

  const convertBook = useCallback(
    async (bookId: string, bookTitle: string) => {
      try {
        setIsConverting(true);
        setConvertingBookId(bookId);
        const toastId = `conversion-${bookId}`;
        setProgressToastId(toastId);

        toast.loading(`Starting conversion of "${bookTitle}"...`, {
          id: toastId,
        });
        onConversionStartedRef.current?.(bookId);

        await invoke("convert_epub_to_audiobook_command", {
          bookId,
          voiceId: defaultVoiceId,
        });
        options?.onConversionComplete?.(bookId);

        // Don't dismiss the toast here - let the progress events handle it
        // The conversion might complete immediately or continue in background
      } catch (err) {
        console.error("Failed to convert book:", err);
        toast.error(
          err instanceof Error ? err.message : "Failed to convert book",
          { id: progressToastId || undefined }
        );
        setIsConverting(false);
        setConvertingBookId(null);
        setProgressToastId(null);
      }
    },
    [defaultVoiceId, progressToastId]
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
      console.error("Failed to cancel conversion:", err);
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
