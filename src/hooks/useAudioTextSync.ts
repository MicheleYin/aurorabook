import { useCallback, useEffect, useRef } from "react";

import type { Book } from "../types/book";
import { useAudioProgressContext } from "../context/AudioProgressContext";
import { useAudioSyncContext } from "../context/AudioSyncContext";
import { useChapterProgressContext } from "../context/ChapterProgressContext";
import { logger } from "../lib/logger";

const HIGHLIGHT_CLASS = "audio-highlight";
const HIGHLIGHT_ENTER_CLASS = "audio-highlight-enter";
const HIGHLIGHT_ACTIVE_CLASS = "audio-highlight-active";
const HIGHLIGHT_EXIT_CLASS = "audio-highlight-exit";

/**
 * Hook for audio-text synchronization
 * Performs text highlighting and scrolling based on audio playback
 *
 * Note: Sync state is managed by AudioSyncContext
 * Use useAudioSyncContext() to get isSyncEnabled and toggleSync
 */
export function useAudioTextSync(
  book: Book | null,
  scrollContainerRef: React.RefObject<HTMLDivElement | null> | null,
  headerRef?: React.RefObject<HTMLDivElement | null>,
  isHeaderVisible?: boolean
) {
  const { audioRef, currentAudioTrack } = useAudioProgressContext();
  const { currentChapter, loadChapterContent } = useChapterProgressContext();
  const { isSyncEnabled } = useAudioSyncContext();

  // Refs for tracking state
  const previousSpanIdRef = useRef<string | null>(null);
  const lastSyncTimeRef = useRef<number>(0);
  const highlightQueueRef = useRef<Set<string>>(new Set());
  const activeHighlightsRef = useRef<Map<string, HTMLElement>>(new Map());
  const previousHeaderVisibleRef = useRef<boolean | undefined>(isHeaderVisible);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncEnabledRef = useRef(isSyncEnabled);
  const previousSyncEnabledRef = useRef(isSyncEnabled);
  const scrollPositionRef = useRef<number | null>(null);

  // Keep ref in sync with context value
  useEffect(() => {
    isSyncEnabledRef.current = isSyncEnabled;
  }, [isSyncEnabled]);

  // Preserve scroll position when sync is toggled
  useEffect(() => {
    if (!scrollContainerRef?.current) return;

    const syncStateChanged = previousSyncEnabledRef.current !== isSyncEnabled;

    if (syncStateChanged) {
      const container = scrollContainerRef.current;
      // Save scroll position before sync state changes
      scrollPositionRef.current = container.scrollTop;

      // Restore scroll position after a brief delay to ensure DOM is stable
      const timeoutId = setTimeout(() => {
        if (container && scrollPositionRef.current !== null) {
          container.scrollTop = scrollPositionRef.current;
          scrollPositionRef.current = null;
        }
      }, 50); // Small delay to ensure DOM updates are complete

      previousSyncEnabledRef.current = isSyncEnabled;

      return () => clearTimeout(timeoutId);
    }
  }, [isSyncEnabled, scrollContainerRef]);

  // Helper: Remove all highlights
  const removeAllHighlights = useCallback(() => {
    const allHighlights = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    allHighlights.forEach((el) => {
      el.classList.remove(
        HIGHLIGHT_CLASS,
        HIGHLIGHT_ENTER_CLASS,
        HIGHLIGHT_ACTIVE_CLASS,
        HIGHLIGHT_EXIT_CLASS
      );
    });
    previousSpanIdRef.current = null;
    highlightQueueRef.current.clear();
    activeHighlightsRef.current.clear();
  }, []);

  // Main sync effect - only runs when sync is enabled AND requirements are met
  useEffect(() => {
    // Clear any existing interval
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    // Early return if sync is disabled
    if (!isSyncEnabled) {
      logger.log("[AudioSync] Sync disabled, removing highlights");
      removeAllHighlights();
      return;
    }

    // Check if all requirements are met
    const hasAllRequirements =
      book &&
      currentAudioTrack &&
      audioRef.current &&
      scrollContainerRef?.current;

    if (!hasAllRequirements) {
      logger.log("[AudioSync] Sync enabled but missing requirements:", {
        hasBook: !!book,
        hasTrack: !!currentAudioTrack,
        hasAudioRef: !!audioRef.current,
        hasScrollContainer: !!scrollContainerRef?.current,
      });
      return;
    }

    const audio = audioRef.current;
    const audioSyncMap = book.audioSyncMap;

    // Check for sync map
    if (!audioSyncMap?.segments || audioSyncMap.segments.length === 0) {
      logger.warn("[AudioSync] No audio sync map available");
      return;
    }

    // Get track href
    const trackHref = currentAudioTrack.href || currentAudioTrack.filePath;
    if (!trackHref) {
      logger.warn("[AudioSync] No track href found");
      return;
    }

    // Find segments for current track
    const trackSegments = audioSyncMap.segments.filter(
      (segment) => segment.audioTrackHref === trackHref
    );

    if (trackSegments.length === 0) {
      logger.warn("[AudioSync] No segments found for current track");
      return;
    }

    logger.log("[AudioSync] Starting sync", {
      bookId: book.id,
      trackId: currentAudioTrack.id,
      segmentsCount: trackSegments.length,
    });

    // Helper: Calculate offsets for header and player
    const calculateOffsets = () => {
      let topOffset = 0;
      if (headerRef?.current && isHeaderVisible) {
        topOffset = headerRef.current.getBoundingClientRect().height;
      }

      let bottomOffset = 0;
      const audioPlayer = document.querySelector(
        '[class*="fixed"][class*="bottom"]'
      ) as HTMLElement;
      if (audioPlayer && currentAudioTrack) {
        const playerRect = audioPlayer.getBoundingClientRect();
        bottomOffset = window.innerHeight - playerRect.top;
      }

      return { topOffset, bottomOffset };
    };

    // Helper: Scroll to element
    const scrollToElement = (
      element: HTMLElement,
      container: HTMLDivElement
    ) => {
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const { topOffset } = calculateOffsets();

      const isVisible =
        elementRect.top >= containerRect.top + topOffset &&
        elementRect.bottom <= containerRect.bottom &&
        elementRect.left >= containerRect.left &&
        elementRect.right <= containerRect.right;

      if (!isVisible) {
        const elementOffsetTop = element.offsetTop - container.offsetTop;
        const oneRem = 16;
        const targetScrollTop = elementOffsetTop - topOffset - oneRem;

        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: "smooth",
        });
      }
    };

    // Helper: Highlight element with animations
    const highlightElement = (elementId: string, element: HTMLElement) => {
      // Skip if already highlighted
      if (
        highlightQueueRef.current.has(elementId) ||
        activeHighlightsRef.current.has(elementId)
      ) {
        return;
      }

      highlightQueueRef.current.add(elementId);

      // Remove previous highlight
      const prevId = previousSpanIdRef.current;
      if (prevId && prevId !== elementId) {
        const previousElement = activeHighlightsRef.current.get(prevId);
        if (previousElement) {
          previousElement.classList.remove(HIGHLIGHT_ACTIVE_CLASS);
          previousElement.classList.add(HIGHLIGHT_EXIT_CLASS);
          setTimeout(() => {
            previousElement.classList.remove(
              HIGHLIGHT_CLASS,
              HIGHLIGHT_EXIT_CLASS
            );
            activeHighlightsRef.current.delete(prevId);
          }, 500);
        }
      }

      // Add new highlight
      element.classList.add(HIGHLIGHT_CLASS, HIGHLIGHT_ENTER_CLASS);
      activeHighlightsRef.current.set(elementId, element);

      setTimeout(() => {
        element.classList.remove(HIGHLIGHT_ENTER_CLASS);
        element.classList.add(HIGHLIGHT_ACTIVE_CLASS);
        highlightQueueRef.current.delete(elementId);
      }, 100);

      // Scroll to element
      if (scrollContainerRef?.current) {
        scrollToElement(element, scrollContainerRef.current);
      }

      previousSpanIdRef.current = elementId;
    };

    // Sync interval - checks isSyncEnabled on each iteration
    syncIntervalRef.current = setInterval(() => {
      // CRITICAL: Check sync is still enabled (use ref to get latest value)
      if (!isSyncEnabledRef.current) {
        return;
      }

      // Check requirements are still met
      if (
        !audio ||
        !scrollContainerRef?.current ||
        !book ||
        !currentAudioTrack
      ) {
        return;
      }

      const currentTime = audio.currentTime;

      // Skip if time hasn't changed
      if (Math.abs(currentTime - lastSyncTimeRef.current) < 0.1) {
        return;
      }
      lastSyncTimeRef.current = currentTime;

      // Find matching segment
      const matchingSegment = trackSegments.find(
        (segment) =>
          currentTime >= segment.clipBegin && currentTime <= segment.clipEnd
      );

      if (!matchingSegment) {
        return;
      }

      const { textElementId, chapterHref } = matchingSegment;

      // Handle chapter switching
      if (currentChapter?.href !== chapterHref) {
        const targetChapter = book.chapters.find(
          (ch) => ch.href === chapterHref
        );
        if (targetChapter) {
          loadChapterContent(book.id, targetChapter).catch((err) => {
            logger.error("[AudioSync] Failed to load chapter:", err);
          });
        }
        return;
      }

      // Find element in DOM
      if (!scrollContainerRef.current) return;
      const contentContainer = scrollContainerRef.current.querySelector(
        ".prose"
      ) as HTMLElement;
      if (!contentContainer) return;

      const element = contentContainer.querySelector(
        `#${textElementId}`
      ) as HTMLElement;

      if (element) {
        highlightElement(textElementId, element);
      }
    }, 200);

    // Cleanup
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [
    isSyncEnabled,
    book,
    currentAudioTrack,
    audioRef,
    currentChapter,
    loadChapterContent,
    scrollContainerRef,
    headerRef,
    isHeaderVisible,
    removeAllHighlights,
  ]);

  // Preserve highlight when header visibility changes
  useEffect(() => {
    if (
      !isSyncEnabled ||
      !scrollContainerRef?.current ||
      previousHeaderVisibleRef.current === isHeaderVisible
    ) {
      previousHeaderVisibleRef.current = isHeaderVisible;
      return;
    }

    const timeoutId = setTimeout(() => {
      if (!scrollContainerRef?.current) return;

      const contentContainer = scrollContainerRef.current.querySelector(
        ".prose"
      ) as HTMLElement;
      if (!contentContainer) return;

      const activeSpanId = previousSpanIdRef.current;
      if (activeSpanId) {
        const element = contentContainer.querySelector(
          `#${activeSpanId}`
        ) as HTMLElement;

        if (element) {
          element.classList.add(HIGHLIGHT_CLASS, HIGHLIGHT_ACTIVE_CLASS);
          activeHighlightsRef.current.set(activeSpanId, element);
        }
      }
    }, 350);

    previousHeaderVisibleRef.current = isHeaderVisible;
    return () => clearTimeout(timeoutId);
  }, [isSyncEnabled, isHeaderVisible, scrollContainerRef]);

  // This hook doesn't return anything - it just performs the sync
  // Use useAudioSyncContext() to get sync state and toggle function
}
