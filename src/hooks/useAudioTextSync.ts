import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { Book } from "../types/book";
import { useAudioProgressContext } from "../context/AudioProgressContext";
import { useAudioSyncContext } from "../context/AudioSyncContext";
import { useChapterProgressContext } from "../context/ChapterProgressContext";
import { logger } from "../lib/logger";
import {
  AUTO_SCROLL_RESUME_MS,
  estimateWordTimings,
  findWordAtTime,
  getProseContainer,
  HIGHLIGHT_WORD_CLASS,
  isElementFullyVisible,
  isFollowScrollPaused,
  resolvePlaybackMarker,
  scrollTopToRevealRect,
  segmentsForPlayback,
  type LiveSyncMarker,
  type PlaybackMarker,
} from "../lib/audio-sync-utils";
import {
  applyHighlight,
  emptyHighlightState,
  removeAllAudioHighlights,
  type HighlightState,
} from "../lib/audio-sync-highlight";

const LIVE_POLL_MS = 250;

function escapeCssId(id: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/([^\w-])/g, "\\$1");
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

  const highlightStateRef = useRef<HighlightState>(emptyHighlightState());
  const isSyncEnabledRef = useRef(isSyncEnabled);
  const previousSyncEnabledRef = useRef(isSyncEnabled);
  const scrollPositionRef = useRef<number | null>(null);
  const liveSyncMarkerRef = useRef<LiveSyncMarker | null>(null);
  const liveSyncPollInFlightRef = useRef(false);
  const liveSyncLastPollRef = useRef(0);
  const lastLiveSentenceIndexRef = useRef<number | null>(null);
  const lastLiveElementOrderRef = useRef<number | null>(null);
  const previousHeaderVisibleRef = useRef<boolean | undefined>(isHeaderVisible);
  const isScrubbingRef = useRef(false);
  const lastUserScrollAtRef = useRef<number | null>(null);
  const followResumeTimerRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const bookRef = useRef(book);
  const currentChapterRef = useRef(currentChapter);
  const currentAudioTrackRef = useRef(currentAudioTrack);
  const loadChapterContentRef = useRef(loadChapterContent);
  const scrollContainerRefInner = useRef(scrollContainerRef);
  const headerRefInner = useRef(headerRef);
  const isHeaderVisibleRef = useRef(isHeaderVisible);

  useEffect(() => {
    isSyncEnabledRef.current = isSyncEnabled;
  }, [isSyncEnabled]);

  useEffect(() => {
    bookRef.current = book;
    currentChapterRef.current = currentChapter;
    currentAudioTrackRef.current = currentAudioTrack;
    loadChapterContentRef.current = loadChapterContent;
    scrollContainerRefInner.current = scrollContainerRef;
    headerRefInner.current = headerRef;
    isHeaderVisibleRef.current = isHeaderVisible;
  });

  useEffect(() => {
    liveSyncMarkerRef.current = null;
    liveSyncPollInFlightRef.current = false;
    liveSyncLastPollRef.current = 0;
    lastLiveSentenceIndexRef.current = null;
    lastLiveElementOrderRef.current = null;
    highlightStateRef.current = emptyHighlightState();
  }, [book?.id, currentAudioTrack?.id]);

  useEffect(() => {
    if (!scrollContainerRef?.current) return;

    const syncStateChanged = previousSyncEnabledRef.current !== isSyncEnabled;

    if (syncStateChanged) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = container.scrollTop;

      const timeoutId = setTimeout(() => {
        if (container && scrollPositionRef.current !== null) {
          container.scrollTop = scrollPositionRef.current;
          scrollPositionRef.current = null;
        }
      }, 50);

      previousSyncEnabledRef.current = isSyncEnabled;

      return () => clearTimeout(timeoutId);
    }
  }, [isSyncEnabled, scrollContainerRef]);

  const removeAllHighlights = useCallback(() => {
    const container = scrollContainerRef?.current;
    if (container) {
      const prose = getProseContainer(container);
      removeAllAudioHighlights(prose ?? container);
    } else {
      removeAllAudioHighlights();
    }
    highlightStateRef.current = emptyHighlightState();
  }, [scrollContainerRef]);

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

      const scoredCandidates: Array<{
        element: HTMLElement;
        score: number;
        order: number;
      }> = [];

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

      const maxScore = Math.max(
        ...scoredCandidates.map((candidate) => candidate.score)
      );
      const topCandidates = scoredCandidates
        .filter((candidate) => candidate.score === maxScore)
        .sort((a, b) => a.order - b.order);

      if (typeof sentenceIndex === "number" && Number.isFinite(sentenceIndex)) {
        const lastSentenceIndex = lastLiveSentenceIndexRef.current;
        const lastOrder = lastLiveElementOrderRef.current;

        if (
          typeof lastSentenceIndex === "number" &&
          typeof lastOrder === "number"
        ) {
          const delta = sentenceIndex - lastSentenceIndex;
          const expectedOrder = lastOrder + delta;

          const bestProgressive = topCandidates.reduce(
            (best, candidate) => {
              const distance = Math.abs(candidate.order - expectedOrder);
              if (!best || distance < best.distance) {
                return { candidate, distance };
              }

              if (distance === best.distance && candidate.order >= expectedOrder) {
                return { candidate, distance };
              }

              return best;
            },
            null as {
              candidate: { element: HTMLElement; score: number; order: number };
              distance: number;
            } | null
          );

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

  const calculateOffsets = useCallback(() => {
    let topOffset = 0;
    const header = headerRefInner.current?.current;
    if (header && isHeaderVisibleRef.current) {
      topOffset = header.getBoundingClientRect().height;
    }

    let bottomOffset = 0;
    const audioPlayer = document.querySelector(
      '[class*="fixed"][class*="bottom"]'
    ) as HTMLElement | null;
    if (audioPlayer && currentAudioTrackRef.current) {
      const playerRect = audioPlayer.getBoundingClientRect();
      bottomOffset = window.innerHeight - playerRect.top;
    }

    return { topOffset, bottomOffset };
  }, []);

  const scrollToElement = useCallback(
    (element: HTMLElement) => {
      const container = scrollContainerRefInner.current?.current;
      if (!container) return;

      const wordEl = element.querySelector(
        `.${HIGHLIGHT_WORD_CLASS}`
      ) as HTMLElement | null;
      const wordRect = wordEl?.getBoundingClientRect();
      const targetEl =
        wordEl && wordRect && (wordRect.height > 0 || wordRect.width > 0)
          ? wordEl
          : element;
      const containerRect = container.getBoundingClientRect();
      const elementRect = targetEl.getBoundingClientRect();
      const offsets = calculateOffsets();

      if (isElementFullyVisible(elementRect, containerRect, offsets)) {
        return;
      }

      const target = scrollTopToRevealRect(
        container.scrollTop,
        elementRect.top,
        containerRect.top,
        containerRect.height,
        container.scrollHeight,
        offsets
      );
      programmaticScrollRef.current = true;
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false;
        programmaticScrollTimerRef.current = null;
      }, 700);
      container.scrollTo({
        top: target,
        behavior: "smooth",
      });
    },
    [calculateOffsets]
  );

  const locateSentenceElement = useCallback(
    (
      container: HTMLElement,
      marker: PlaybackMarker,
      isLiveTrack: boolean
    ): HTMLElement | null => {
      const byId = container.querySelector(
        `#${escapeCssId(marker.sentenceId)}`
      ) as HTMLElement | null;
      if (byId) return byId;

      if (!isLiveTrack) return null;

      const textMatched = findBestElementBySentence(
        container,
        marker.sentenceText,
        liveSyncMarkerRef.current?.sentenceIndex
      );
      if (textMatched) {
        const markerSentenceIndex = liveSyncMarkerRef.current?.sentenceIndex;
        if (typeof markerSentenceIndex === "number") {
          lastLiveSentenceIndexRef.current = markerSentenceIndex;
          lastLiveElementOrderRef.current = textMatched.order;
        }
        return textMatched.element;
      }

      const markerMatch = /^f(\d+)$/.exec(marker.sentenceId);
      if (!markerMatch) return null;
      const targetIndex = Number.parseInt(markerMatch[1], 10);
      if (!Number.isFinite(targetIndex)) return null;

      let bestElement: HTMLElement | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      let bestIsAhead = true;

      container.querySelectorAll("span[id^='f']").forEach((candidate) => {
        const el = candidate as HTMLElement;
        const match = /^f(\d+)$/.exec(el.id);
        if (!match) return;
        const idx = Number.parseInt(match[1], 10);
        if (!Number.isFinite(idx)) return;
        const diff = Math.abs(idx - targetIndex);
        const isAhead = idx > targetIndex;
        if (diff < bestDiff || (diff === bestDiff && bestIsAhead && !isAhead)) {
          bestDiff = diff;
          bestIsAhead = isAhead;
          bestElement = el;
        }
      });

      return bestElement;
    },
    [findBestElementBySentence]
  );

  const syncFromClockRef = useRef<(allowScroll: boolean) => void>(() => {});

  const pollLiveMarker = useCallback(
    (currentTime: number) => {
      const bookValue = bookRef.current;
      const track = currentAudioTrackRef.current;
      if (!bookValue || !track) return;

      const chapterIndex =
        typeof track.liveChapterIndex === "number"
          ? track.liveChapterIndex
          : track.order;
      if (chapterIndex < 0) return;

      const now = Date.now();
      if (
        liveSyncPollInFlightRef.current ||
        now - liveSyncLastPollRef.current < LIVE_POLL_MS
      ) {
        return;
      }

      liveSyncPollInFlightRef.current = true;
      liveSyncLastPollRef.current = now;
      invoke<LiveSyncMarker>("get_live_sync_marker", {
        bookId: bookValue.id,
        chapterIndex,
        currentTimeSeconds: currentTime,
      })
        .then((marker) => {
          liveSyncMarkerRef.current = marker;
          syncFromClockRef.current(!isScrubbingRef.current);
        })
        .catch((err) => {
          logger.warn("[AudioSync] Failed to poll live sync marker:", err);
        })
        .finally(() => {
          liveSyncPollInFlightRef.current = false;
        });
    },
    []
  );

  const pauseFollowScroll = useCallback(() => {
    lastUserScrollAtRef.current = Date.now();
    if (followResumeTimerRef.current !== null) {
      window.clearTimeout(followResumeTimerRef.current);
    }
    followResumeTimerRef.current = window.setTimeout(() => {
      lastUserScrollAtRef.current = null;
      followResumeTimerRef.current = null;
      if (isSyncEnabledRef.current) {
        syncFromClockRef.current(true);
      }
    }, AUTO_SCROLL_RESUME_MS);
  }, []);

  const syncFromClock = useCallback(
    (allowScroll: boolean) => {
      if (!isSyncEnabledRef.current) return;

      const audio = audioRef.current;
      const bookValue = bookRef.current;
      const track = currentAudioTrackRef.current;
      const scrollContainer = scrollContainerRefInner.current?.current;
      if (!audio || !bookValue || !track || !scrollContainer) return;

      const followScroll =
        allowScroll &&
        !isFollowScrollPaused(lastUserScrollAtRef.current, Date.now());

      const currentTime = audio.currentTime;
      const isLiveTrack = Boolean(track.isLiveStream);
      if (isLiveTrack) {
        pollLiveMarker(currentTime);
      }

      const liveChapterHref =
        track.chapterHref ||
        (typeof track.liveChapterIndex === "number" &&
        track.liveChapterIndex >= 0 &&
        track.liveChapterIndex < bookValue.chapters.length
          ? bookValue.chapters[track.liveChapterIndex].href
          : undefined);
      const trackSegments = segmentsForPlayback(
        bookValue.audioSyncMap?.segments || [],
        track.href || track.filePath,
        { isLiveTrack, liveChapterHref }
      );

      if (!isLiveTrack && trackSegments.length === 0) {
        return;
      }

      let marker = resolvePlaybackMarker({
        time: currentTime,
        segments: trackSegments,
        liveMarker: liveSyncMarkerRef.current,
        isLiveTrack,
      });

      if (!marker) return;

      const chapterHref = marker.chapterHref;
      if (
        chapterHref &&
        !hrefMatches(currentChapterRef.current?.href, chapterHref)
      ) {
        const targetChapter = bookValue.chapters.find((ch) =>
          hrefMatches(ch.href, chapterHref)
        );
        if (targetChapter) {
          loadChapterContentRef.current(bookValue.id, targetChapter).catch(
            (err) => {
              logger.error("[AudioSync] Failed to load chapter:", err);
            }
          );
        }
        return;
      }

      const contentContainer = getProseContainer(scrollContainer);
      if (!contentContainer) return;

      const sentenceEl = locateSentenceElement(
        contentContainer,
        marker,
        isLiveTrack
      );
      if (!sentenceEl) return;

      if (!marker.words || marker.words.length === 0) {
        const text = (marker.sentenceText || sentenceEl.textContent || "").trim();
        const clipBegin = marker.clipBegin ?? currentTime;
        const clipEnd = marker.clipEnd ?? currentTime;
        if (text) {
          const words = estimateWordTimings(text, clipBegin, clipEnd);
          marker = {
            ...marker,
            words,
            wordIndex: findWordAtTime(words, currentTime),
          };
        }
      }

      highlightStateRef.current = applyHighlight(
        marker,
        sentenceEl,
        highlightStateRef.current,
        {
          allowScroll: followScroll,
          scrollToElement,
        }
      );
    },
    [
      audioRef,
      hrefMatches,
      locateSentenceElement,
      pollLiveMarker,
      scrollToElement,
    ]
  );

  useEffect(() => {
    syncFromClockRef.current = syncFromClock;
  }, [syncFromClock]);

  useEffect(() => {
    if (!isSyncEnabled) return;
    const container = scrollContainerRef?.current;
    if (!container) return;

    const onUserScrollIntent = () => {
      if (programmaticScrollRef.current) return;
      pauseFollowScroll();
    };
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      pauseFollowScroll();
    };

    container.addEventListener("wheel", onUserScrollIntent, { passive: true });
    container.addEventListener("touchmove", onUserScrollIntent, {
      passive: true,
    });
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      container.removeEventListener("wheel", onUserScrollIntent);
      container.removeEventListener("touchmove", onUserScrollIntent);
      container.removeEventListener("scroll", onScroll);
      if (followResumeTimerRef.current !== null) {
        window.clearTimeout(followResumeTimerRef.current);
        followResumeTimerRef.current = null;
      }
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
      programmaticScrollRef.current = false;
    };
  }, [isSyncEnabled, scrollContainerRef, pauseFollowScroll]);

  useEffect(() => {
    const audio = audioRef.current;

    const stopRaf = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const tick = () => {
      if (!isSyncEnabledRef.current) {
        stopRaf();
        return;
      }
      syncFromClock(!isScrubbingRef.current);
      const el = audioRef.current;
      if (el && !el.paused && !el.ended) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
      }
    };

    const startRaf = () => {
      if (rafIdRef.current !== null) return;
      const el = audioRef.current;
      if (!el || el.paused || el.ended) return;
      rafIdRef.current = requestAnimationFrame(tick);
    };

    if (!isSyncEnabled) {
      stopRaf();
      removeAllHighlights();
      return;
    }

    if (
      !book ||
      !currentAudioTrack ||
      !audio ||
      !scrollContainerRef?.current
    ) {
      return;
    }

    logger.log("[AudioSync] Starting sync", {
      bookId: book.id,
      trackId: currentAudioTrack.id,
      segmentsCount: book.audioSyncMap?.segments?.length ?? 0,
    });

    const onSeeking = () => {
      isScrubbingRef.current = true;
      syncFromClock(false);
    };
    const onSeeked = () => {
      isScrubbingRef.current = false;
      syncFromClock(true);
    };
    const onTimeUpdate = () => {
      if (isScrubbingRef.current) return;
      syncFromClock(true);
    };
    const onPlay = () => {
      startRaf();
    };
    const onPause = () => {
      stopRaf();
    };

    audio.addEventListener("seeking", onSeeking);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    syncFromClock(true);
    if (!audio.paused) startRaf();

    return () => {
      stopRaf();
      audio.removeEventListener("seeking", onSeeking);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [
    isSyncEnabled,
    book,
    currentAudioTrack,
    audioRef,
    scrollContainerRef,
    removeAllHighlights,
    syncFromClock,
  ]);

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
      const container = scrollContainerRef.current;
      if (!container) return;
      const contentContainer = getProseContainer(container);
      if (!contentContainer) return;
      const activeSpanId = highlightStateRef.current.sentenceId;
      if (!activeSpanId) return;
      const element = contentContainer.querySelector(
        `#${escapeCssId(activeSpanId)}`
      ) as HTMLElement | null;
      if (element) {
        element.classList.add("audio-highlight", "audio-highlight-active");
        highlightStateRef.current.sentenceEl = element;
      }
    }, 350);

    previousHeaderVisibleRef.current = isHeaderVisible;
    return () => clearTimeout(timeoutId);
  }, [isSyncEnabled, isHeaderVisible, scrollContainerRef]);
}
