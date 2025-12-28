/**
 * Centralized Conversion Event Listener Manager
 *
 * Sets up event listeners once at the app level and allows
 * multiple components to subscribe/unsubscribe to events.
 * This prevents duplicate listeners and allows handlers to be reset.
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
import { listen } from "@tauri-apps/api/event";

import { logger } from "../lib/logger";

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

type ProgressHandler = (progress: ConversionProgress) => void;
type ChapterCompletedHandler = (event: ChapterCompletedEvent) => void;
type ConversionCancelledHandler = (event: ConversionCancelledEvent) => void;

interface ConversionEventContextValue {
  subscribeToProgress: (handler: ProgressHandler) => () => void;
  subscribeToChapterCompleted: (handler: ChapterCompletedHandler) => () => void;
  subscribeToCancelled: (handler: ConversionCancelledHandler) => () => void;
  isReady: boolean;
}

const ConversionEventContext =
  createContext<ConversionEventContextValue | null>(null);

interface ConversionEventProviderProps {
  children: ReactNode;
}

export function ConversionEventProvider({
  children,
}: Readonly<ConversionEventProviderProps>) {
  const progressHandlersRef = useRef<Set<ProgressHandler>>(new Set());
  const chapterCompletedHandlersRef = useRef<Set<ChapterCompletedHandler>>(
    new Set()
  );
  const cancelledHandlersRef = useRef<Set<ConversionCancelledHandler>>(
    new Set()
  );
  const [isReady, setIsReady] = useState<boolean>(false);
  const unlistenFunctionsRef = useRef<{
    progress: (() => void) | null;
    chapterCompleted: (() => void) | null;
    cancelled: (() => void) | null;
  }>({
    progress: null,
    chapterCompleted: null,
    cancelled: null,
  });

  // Set up listeners once
  useEffect(() => {
    let isMounted = true;
    let setupComplete = false;

    const setupListeners = async () => {
      try {
        logger.log("Setting up conversion event listeners...");

        // Set up progress listener
        const progressUnlisten = await listen<ConversionProgress>(
          "conversion-progress",
          (event) => {
            if (!isMounted) return;
            const progress = event.payload;
            // Call all registered handlers
            progressHandlersRef.current.forEach((handler) => {
              try {
                handler(progress);
              } catch (error) {
                logger.error("Error in progress handler:", error);
              }
            });
          }
        );

        // Set up chapter completed listener
        const chapterCompletedUnlisten = await listen<ChapterCompletedEvent>(
          "chapter-completed",
          (event) => {
            if (!isMounted) return;
            const chapterEvent = event.payload;
            // Call all registered handlers
            chapterCompletedHandlersRef.current.forEach((handler) => {
              try {
                handler(chapterEvent);
              } catch (error) {
                logger.error("Error in chapter completed handler:", error);
              }
            });
          }
        );

        // Set up cancelled listener
        const cancelledUnlisten = await listen<ConversionCancelledEvent>(
          "conversion-cancelled",
          (event) => {
            if (!isMounted) return;
            const cancelledEvent = event.payload;
            // Call all registered handlers
            cancelledHandlersRef.current.forEach((handler) => {
              try {
                handler(cancelledEvent);
              } catch (error) {
                logger.error("Error in cancelled handler:", error);
              }
            });
          }
        );

        if (isMounted) {
          unlistenFunctionsRef.current = {
            progress: progressUnlisten,
            chapterCompleted: chapterCompletedUnlisten,
            cancelled: cancelledUnlisten,
          };
          setIsReady(true);
          setupComplete = true;
          logger.log("Conversion event listeners set up successfully");
        } else {
          // Component unmounted during setup, clean up immediately
          progressUnlisten();
          chapterCompletedUnlisten();
          cancelledUnlisten();
        }
      } catch (error) {
        logger.error("Failed to set up conversion event listeners:", error);
        // Retry setup after a short delay
        setTimeout(() => {
          if (isMounted && !setupComplete) {
            logger.log("Retrying conversion event listener setup...");
            setupListeners();
          }
        }, 1000);
      }
    };

    setupListeners();

    return () => {
      isMounted = false;
      setIsReady(false);

      // Clean up listeners
      if (unlistenFunctionsRef.current.progress) {
        try {
          unlistenFunctionsRef.current.progress();
        } catch (e) {
          logger.error("Error unlistening from conversion-progress:", e);
        }
      }
      if (unlistenFunctionsRef.current.chapterCompleted) {
        try {
          unlistenFunctionsRef.current.chapterCompleted();
        } catch (e) {
          logger.error("Error unlistening from chapter-completed:", e);
        }
      }
      if (unlistenFunctionsRef.current.cancelled) {
        try {
          unlistenFunctionsRef.current.cancelled();
        } catch (e) {
          logger.error("Error unlistening from conversion-cancelled:", e);
        }
      }

      // Clear all handlers
      progressHandlersRef.current.clear();
      chapterCompletedHandlersRef.current.clear();
      cancelledHandlersRef.current.clear();
    };
  }, []); // Set up once on mount

  const subscribeToProgress = useCallback((handler: ProgressHandler) => {
    progressHandlersRef.current.add(handler);
    logger.log(
      `Subscribed to progress events (${progressHandlersRef.current.size} total subscribers)`
    );

    // Return unsubscribe function
    return () => {
      progressHandlersRef.current.delete(handler);
      logger.log(
        `Unsubscribed from progress events (${progressHandlersRef.current.size} remaining)`
      );
    };
  }, []);

  const subscribeToChapterCompleted = useCallback(
    (handler: ChapterCompletedHandler) => {
      chapterCompletedHandlersRef.current.add(handler);
      logger.log(
        `Subscribed to chapter completed events (${chapterCompletedHandlersRef.current.size} total subscribers)`
      );

      // Return unsubscribe function
      return () => {
        chapterCompletedHandlersRef.current.delete(handler);
        logger.log(
          `Unsubscribed from chapter completed events (${chapterCompletedHandlersRef.current.size} remaining)`
        );
      };
    },
    []
  );

  const subscribeToCancelled = useCallback(
    (handler: ConversionCancelledHandler) => {
      cancelledHandlersRef.current.add(handler);
      logger.log(
        `Subscribed to cancelled events (${cancelledHandlersRef.current.size} total subscribers)`
      );

      // Return unsubscribe function
      return () => {
        cancelledHandlersRef.current.delete(handler);
        logger.log(
          `Unsubscribed from cancelled events (${cancelledHandlersRef.current.size} remaining)`
        );
      };
    },
    []
  );

  const value: ConversionEventContextValue = useMemo(
    () => ({
      subscribeToProgress,
      subscribeToChapterCompleted,
      subscribeToCancelled,
      isReady,
    }),
    [
      subscribeToProgress,
      subscribeToChapterCompleted,
      subscribeToCancelled,
      isReady,
    ]
  );

  return (
    <ConversionEventContext.Provider value={value}>
      {children}
    </ConversionEventContext.Provider>
  );
}

export function useConversionEvents() {
  const context = useContext(ConversionEventContext);
  if (!context) {
    throw new Error(
      "useConversionEvents must be used within a ConversionEventProvider"
    );
  }
  return context;
}
