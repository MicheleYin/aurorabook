import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { Book } from "../types/book";
import { useAudioProgressContext } from "../context/AudioProgressContext";
import { useAudioSyncContext } from "../context/AudioSyncContext";
import { useChapterProgressContext } from "../context/ChapterProgressContext";
import { logger } from "../lib/logger";

const HIGHLIGHT_CLASS = "audio-highlight";
const HIGHLIGHT_ENTER_CLASS = "audio-highlight-enter";
const HIGHLIGHT_ACTIVE_CLASS = "audio-highlight-active";
const HIGHLIGHT_EXIT_CLASS = "audio-highlight-exit";

interface LiveSyncMarker {
  textElementId?: string;
  smilId?: string;
  chapterId?: string;
  chapterHref?: string;
  sentenceIndex?: number;
  clipBegin?: number;
  clipEnd?: number;
  sentenceText?: string;
}

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
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncEnabledRef = useRef(isSyncEnabled);
  const previousSyncEnabledRef = useRef(isSyncEnabled);
  const scrollPositionRef = useRef<number | null>(null);
  const liveSyncMarkerRef = useRef<LiveSyncMarker | null>(null);
  const liveSyncPollInFlightRef = useRef(false);
  const liveSyncLastPollRef = useRef(0);
  const lastLiveSentenceIndexRef = useRef<number | null>(null);
  const lastLiveElementOrderRef = useRef<number | null>(null);

  // Keep ref in sync with context value
  useEffect(() => {
    isSyncEnabledRef.current = isSyncEnabled;
  }, [isSyncEnabled]);

  // Reset live marker cache when book or track changes
  useEffect(() => {
    liveSyncMarkerRef.current = null;
    liveSyncPollInFlightRef.current = false;
    liveSyncLastPollRef.current = 0;
    lastLiveSentenceIndexRef.current = null;
    lastLiveElementOrderRef.current = null;
    lastSyncTimeRef.current = 0;
    previousSpanIdRef.current = null;
  }, [book?.id, currentAudioTrack?.id]);

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

  const normalizeHref = useCallback((href?: string) => {
    if (!href) return "";
    return href
      .split(/[?#]/)[0]
      .replace(/^\/+/, "")
      .trim();
  }, []);

  const hrefMatches = useCallback(
    (a?: string, b?: string) => {
      const left = normalizeHref(a);
      const right = normalizeHref(b);

      if (!left || !right) return false;
      if (left === right) return true;

      return left.endsWith(right) || right.endsWith(left);
    },
    [normalizeHref]
  );

  const normalizeSentence = useCallback((text?: string) => {
    if (!text) return "";
    return text
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }, []);

  const findBestElementBySentence = useCallback(
    (
      container: HTMLElement,
      sentenceText?: string,
      sentenceIndex?: number
    ): { element: HTMLElement; order: number } | null => {
      const normalizedTarget = normalizeSentence(sentenceText);
      if (!normalizedTarget || normalizedTarget.length < 12) {
        return null;
      }

      const targetWords = normalizedTarget
        .split(" ")
        .filter((w) => w.length >= 4)
        .slice(0, 14);

      if (targetWords.length === 0) {
        return null;
      }

      const orderedElements = Array.from(
        container.querySelectorAll("a[id], p, li, blockquote")
      ) as HTMLElement[];

      const scoredCandidates: Array<{ element: HTMLElement; score: number; order: number }> = [];

      orderedElements.forEach((element, order) => {
        const normalizedText = normalizeSentence(element.textContent || "");
        if (!normalizedText) return;

        let score = 0;
        for (const word of targetWords) {
          if (normalizedText.includes(word)) {
            score += 1;
          }
        }

        if (score >= 3) {
          scoredCandidates.push({ element, score, order });
        }
      });

      if (scoredCandidates.length === 0) {
        return null;
      }

      const maxScore = Math.max(...scoredCandidates.map((candidate) => candidate.score));
      const topCandidates = scoredCandidates
        .filter((candidate) => candidate.score === maxScore)
        .sort((a, b) => a.order - b.order);

      // If we have sentence progression data, choose candidate closest to expected order.
      if (typeof sentenceIndex === "number" && Number.isFinite(sentenceIndex)) {
        const lastSentenceIndex = lastLiveSentenceIndexRef.current;
        const lastOrder = lastLiveElementOrderRef.current;

        if (
          typeof lastSentenceIndex === "number" &&
          typeof lastOrder === "number"
        ) {
          const delta = sentenceIndex - lastSentenceIndex;
          const expectedOrder = delta >= 0 ? lastOrder + delta : lastOrder + delta;

          const bestProgressive = topCandidates.reduce((best, candidate) => {
            const distance = Math.abs(candidate.order - expectedOrder);
            if (!best || distance < best.distance) {
              return { candidate, distance };
            }

            if (distance === best.distance && candidate.order >= expectedOrder) {
              return { candidate, distance };
            }

            return best;
          }, null as { candidate: { element: HTMLElement; score: number; order: number }; distance: number } | null);

          if (bestProgressive) {
            return {
              element: bestProgressive.candidate.element,
              order: bestProgressive.candidate.order,
            };
          }
        }
      }

      return {
        element: topCandidates[0].element,
        order: topCandidates[0].order,
      };
    },
    [normalizeSentence]
  );

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
    const isLiveTrack = Boolean(currentAudioTrack.isLiveStream);

    // Non-live tracks require static sync map segments.
    if (!isLiveTrack && (!audioSyncMap?.segments || audioSyncMap.segments.length === 0)) {
      logger.warn("[AudioSync] No audio sync map available");
      return;
    }

    // Get track href
    const trackHref = currentAudioTrack.href || currentAudioTrack.filePath;
    if (!isLiveTrack && !trackHref) {
      logger.warn("[AudioSync] No track href found");
      return;
    }

    // Find segments for current track; live streams may not have a track href in sync map.
    let trackSegments = (audioSyncMap?.segments || []).filter(
      (segment) => segment.audioTrackHref === trackHref
    );

    if (
      trackSegments.length === 0 &&
      isLiveTrack
    ) {
      const liveChapterHref =
        currentAudioTrack.chapterHref ||
        (typeof currentAudioTrack.liveChapterIndex === "number" &&
        currentAudioTrack.liveChapterIndex >= 0 &&
        currentAudioTrack.liveChapterIndex < book.chapters.length
          ? book.chapters[currentAudioTrack.liveChapterIndex].href
          : undefined);

      if (liveChapterHref) {
        trackSegments = (audioSyncMap?.segments || []).filter(
          (segment) => segment.chapterHref === liveChapterHref
        );
      }
    }

    if (!isLiveTrack && trackSegments.length === 0) {
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
      const { topOffset, bottomOffset } = calculateOffsets();

      // Check if element is fully visible within the available viewport
      // (accounting for header at top and audio player at bottom)
      const isVisible =
        elementRect.top >= containerRect.top + topOffset &&
        elementRect.bottom <= containerRect.bottom - bottomOffset &&
        elementRect.left >= containerRect.left &&
        elementRect.right <= containerRect.right;

      if (!isVisible) {
        const elementOffsetTop = element.offsetTop - container.offsetTop;
        const oneRem = 8;
        // Position element 1rem below header, ensuring it's above audio player
        const targetScrollTop = elementOffsetTop - topOffset - oneRem;

        // Ensure we don't scroll past the bottom (accounting for audio player)
        const maxScrollTop =
          container.scrollHeight - containerRect.height + bottomOffset;
        const clampedScrollTop = Math.min(
          Math.max(0, targetScrollTop),
          maxScrollTop
        );

        container.scrollTo({
          top: clampedScrollTop,
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

      if (isLiveTrack && book) {
        const now = Date.now();
        const chapterIndex =
          typeof currentAudioTrack.liveChapterIndex === "number"
            ? currentAudioTrack.liveChapterIndex
            : currentAudioTrack.order;

        if (
          chapterIndex >= 0 &&
          !liveSyncPollInFlightRef.current &&
          now - liveSyncLastPollRef.current >= 250
        ) {
          liveSyncPollInFlightRef.current = true;
          liveSyncLastPollRef.current = now;

          invoke<LiveSyncMarker>("get_live_sync_marker", {
            bookId: book.id,
            chapterIndex,
            currentTimeSeconds: currentTime,
          })
            .then((marker) => {
              liveSyncMarkerRef.current = marker;
            })
            .catch((err) => {
              logger.warn("[AudioSync] Failed to poll live sync marker:", err);
            })
            .finally(() => {
              liveSyncPollInFlightRef.current = false;
            });
        }
      }

      // Skip if time hasn't changed
      if (Math.abs(currentTime - lastSyncTimeRef.current) < 0.1) {
        return;
      }
      lastSyncTimeRef.current = currentTime;

      let textElementId: string | undefined;
      let chapterHref: string | undefined;

      if (isLiveTrack) {
        textElementId =
          liveSyncMarkerRef.current?.textElementId ||
          liveSyncMarkerRef.current?.smilId;
        chapterHref = liveSyncMarkerRef.current?.chapterHref;

        if (!chapterHref) {
          chapterHref = currentAudioTrack.chapterHref;
        }
      }

      if (!textElementId && trackSegments.length > 0) {
        // Fallback to static segment-based matching when live marker is unavailable.
        const matchingSegment = trackSegments.find(
          (segment) =>
            currentTime >= segment.clipBegin && currentTime <= segment.clipEnd
        );

        if (!matchingSegment) {
          return;
        }

        textElementId = matchingSegment.textElementId;
        chapterHref = matchingSegment.chapterHref;
      }

      if (!textElementId) {
        return;
      }

      // Handle chapter switching
      if (chapterHref && !hrefMatches(currentChapter?.href, chapterHref)) {
        const targetChapter = book.chapters.find(
          (ch) => hrefMatches(ch.href, chapterHref)
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
        return;
      }

      // Live chapters may not contain generated span IDs; fallback to sentence text matching.
      if (isLiveTrack) {
        const textMatchedElement = findBestElementBySentence(
          contentContainer,
          liveSyncMarkerRef.current?.sentenceText,
          liveSyncMarkerRef.current?.sentenceIndex
        );

        if (textMatchedElement) {
          const markerSentenceIndex = liveSyncMarkerRef.current?.sentenceIndex;
          if (typeof markerSentenceIndex === "number") {
            lastLiveSentenceIndexRef.current = markerSentenceIndex;
            lastLiveElementOrderRef.current = textMatchedElement.order;
          }

          const fallbackId =
            textMatchedElement.element.id ||
            `live-sentence-${liveSyncMarkerRef.current?.sentenceIndex ?? textElementId}`;
          highlightElement(fallbackId, textMatchedElement.element);
          return;
        }

        // Last fallback: nearest synthetic fNNNNNN span if available.
        const markerMatch = /^f(\d+)$/.exec(textElementId);
        if (!markerMatch) {
          return;
        }

        const targetIndex = Number.parseInt(markerMatch[1], 10);
        if (!Number.isFinite(targetIndex)) {
          return;
        }

        let bestElementId: string | null = null;
        let bestDiff = Number.POSITIVE_INFINITY;
        let bestIsAhead = true;

        const candidates = contentContainer.querySelectorAll("span[id^='f']");
        candidates.forEach((candidate) => {
          const el = candidate as HTMLElement;
          const id = el.id;
          const match = /^f(\d+)$/.exec(id);
          if (!match) return;

          const idx = Number.parseInt(match[1], 10);
          if (!Number.isFinite(idx)) return;

          const diff = Math.abs(idx - targetIndex);
          const isAhead = idx > targetIndex;

          // Prefer nearest previous span over a future span when distances are equal.
          if (
            diff < bestDiff ||
            (diff === bestDiff && bestIsAhead && !isAhead)
          ) {
            bestDiff = diff;
            bestIsAhead = isAhead;
            bestElementId = el.id;
          }
        });

        if (bestElementId) {
          const fallbackElement = contentContainer.querySelector(
            `#${bestElementId}`
          ) as HTMLElement;
          if (fallbackElement) {
            highlightElement(bestElementId, fallbackElement);
          }
        }
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
    hrefMatches,
    findBestElementBySentence,
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
