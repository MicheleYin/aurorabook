import type { AudioSyncSegment, WordSyncCue } from "../types/book";

export const HIGHLIGHT_CLASS = "audio-highlight";
export const HIGHLIGHT_ENTER_CLASS = "audio-highlight-enter";
export const HIGHLIGHT_ACTIVE_CLASS = "audio-highlight-active";
export const HIGHLIGHT_EXIT_CLASS = "audio-highlight-exit";
export const HIGHLIGHT_WORD_CLASS = "audio-highlight-word";
export const AUDIO_WORD_CLASS = "audio-word";

/** Minimum time delta (seconds) before re-running sync highlight logic. */
export const SYNC_TIME_EPSILON = 0.1;

/** Pause follow-scroll after the user moves the reader, then resume. */
export const AUTO_SCROLL_RESUME_MS = 1800;

export interface LiveSyncMarker {
  textElementId?: string;
  smilId?: string;
  chapterId?: string;
  chapterHref?: string;
  sentenceIndex?: number;
  clipBegin?: number;
  clipEnd?: number;
  sentenceText?: string;
  wordAlignments?: WordSyncCue[];
  currentWordIndex?: number;
}

export interface PlaybackMarker {
  time: number;
  sentenceId: string;
  chapterHref?: string;
  wordIndex?: number;
  sentenceText?: string;
  words?: WordSyncCue[];
  clipBegin?: number;
  clipEnd?: number;
}

export interface ResolvePlaybackInput {
  time: number;
  segments: AudioSyncSegment[];
  liveMarker?: LiveSyncMarker | null;
  isLiveTrack?: boolean;
}

/** Returns the prose container, piercing the shadow DOM when present. */
export function getProseContainer(
  scrollContainer: HTMLElement
): HTMLElement | null {
  const shadowHost = scrollContainer.querySelector<HTMLElement>(
    "[data-reader-chapter-shadow-host]"
  );
  if (shadowHost?.shadowRoot) {
    return shadowHost.shadowRoot.querySelector<HTMLElement>(
      "[data-reader-chapter-content]"
    );
  }
  return scrollContainer.querySelector<HTMLElement>(".prose");
}

/** Segments belonging to the current audio track href. */
export function filterSegmentsForTrack(
  segments: AudioSyncSegment[],
  trackHref: string
): AudioSyncSegment[] {
  return segments.filter((segment) => segment.audioTrackHref === trackHref);
}

export function segmentsForPlayback(
  segments: AudioSyncSegment[],
  trackHref: string | undefined,
  options?: {
    isLiveTrack?: boolean;
    liveChapterHref?: string;
  }
): AudioSyncSegment[] {
  let trackSegments = filterSegmentsForTrack(segments, trackHref || "");
  if (trackSegments.length === 0 && options?.isLiveTrack && options.liveChapterHref) {
    trackSegments = segments.filter(
      (segment) => segment.chapterHref === options.liveChapterHref
    );
  }
  trackSegments.sort((a, b) => a.clipBegin - b.clipBegin);
  return trackSegments;
}

/**
 * Active sync segment for the current playback time.
 * Half-open windows `[clipBegin, clipEnd)` so a shared boundary maps to the next sentence.
 * The last segment includes its `clipEnd`.
 */
export function findSegmentAtTime(
  segments: AudioSyncSegment[],
  currentTime: number
): AudioSyncSegment | undefined {
  if (segments.length === 0) return undefined;

  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const segment = segments[mid];
    const isLast = mid === segments.length - 1;
    const inRange = isLast
      ? currentTime >= segment.clipBegin && currentTime <= segment.clipEnd
      : currentTime >= segment.clipBegin && currentTime < segment.clipEnd;

    if (inRange) return segment;
    if (currentTime < segment.clipBegin) {
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return undefined;
}

/** Word index whose window contains `currentTime` (chapter-relative). */
export function findWordAtTime(
  words: WordSyncCue[] | undefined,
  currentTime: number
): number | undefined {
  if (!words || words.length === 0) return undefined;

  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const word = words[mid];
    const start = wordCueStart(word);
    const end = wordCueEnd(word);
    const isLast = mid === words.length - 1;
    const inRange = isLast
      ? currentTime >= start && currentTime <= end
      : currentTime >= start && currentTime < end;

    if (inRange) return mid;
    if (currentTime < start) {
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  if (currentTime < wordCueStart(words[0])) return 0;
  if (currentTime >= wordCueEnd(words[words.length - 1])) {
    return words.length - 1;
  }
  return undefined;
}

export function wordCueStart(cue: WordSyncCue): number {
  if (typeof cue.startSec === "number" && Number.isFinite(cue.startSec)) {
    return cue.startSec;
  }
  const legacy = (cue as WordSyncCue & { start_sec?: number }).start_sec;
  return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : 0;
}

export function wordCueEnd(cue: WordSyncCue): number {
  if (typeof cue.endSec === "number" && Number.isFinite(cue.endSec)) {
    return cue.endSec;
  }
  const legacy = (cue as WordSyncCue & { end_sec?: number }).end_sec;
  return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : 0;
}

/** Keep every word cue inside `[lo, hi]` (the sentence clip). */
export function clampWordCues(
  words: WordSyncCue[],
  lo: number,
  hi: number
): WordSyncCue[] {
  if (words.length === 0) return words;
  const spanLo = Math.min(lo, hi);
  const spanHi = Math.max(lo, hi);
  const clamped = words.map((word) => {
    const startSec = Math.min(spanHi, Math.max(spanLo, wordCueStart(word)));
    let endSec = Math.min(spanHi, Math.max(spanLo, wordCueEnd(word)));
    if (endSec < startSec) endSec = startSec;
    return { word: word.word, startSec, endSec };
  });
  const last = clamped[clamped.length - 1];
  last.endSec = spanHi;
  if (last.endSec < last.startSec) {
    last.startSec = last.endSec;
  }
  return clamped;
}

const COMMA_PAUSE_SEC = 0.05;
const SENTENCE_PAUSE_SEC = 0.12;
const MAX_PAUSE_FRACTION = 0.25;

/** Character-weighted word timings for books that only have sentence clips. */
export function estimateWordTimings(
  text: string,
  clipBegin: number,
  clipEnd: number
): WordSyncCue[] {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return [];

  const duration = Math.max(0.001, clipEnd - clipBegin);
  const weights = tokens.map((token) =>
    Math.max(1, Array.from(token).filter((ch) => /[0-9A-Za-z\u00C0-\u024F]/.test(ch)).length)
  );
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const rawPauses = tokens.map((token) => pauseAfter(token));
  const pauseSum = rawPauses.reduce((sum, pause) => sum + pause, 0);
  const maxPause = duration * MAX_PAUSE_FRACTION;
  const pauseScale =
    pauseSum > maxPause && pauseSum > 0 ? maxPause / pauseSum : 1;
  const pauses = rawPauses.map((pause) => pause * pauseScale);
  const pauseBudget = pauses.reduce((sum, pause) => sum + pause, 0);
  const speechForWords = Math.max(duration * 0.5, duration - pauseBudget);

  const cues: WordSyncCue[] = [];
  let cursor = clipBegin;
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const wordDur = speechForWords * (weights[idx] / weightSum);
    const pause = idx + 1 < tokens.length ? pauses[idx] : 0;
    const startSec = cursor;
    const endSec =
      idx + 1 === tokens.length
        ? clipEnd
        : startSec + wordDur + pause;
    cues.push({
      word: tokens[idx],
      startSec,
      endSec: Math.max(startSec, endSec),
    });
    cursor = cues[cues.length - 1].endSec;
  }
  return clampWordCues(cues, clipBegin, clipEnd);
}

function pauseAfter(word: string): number {
  const last = word.trimEnd().slice(-1);
  if (".!?…".includes(last)) return SENTENCE_PAUSE_SEC;
  if (",;:".includes(last)) return COMMA_PAUSE_SEC;
  return 0;
}

function liveWordsForMarker(
  liveMarker: LiveSyncMarker
): WordSyncCue[] | undefined {
  const clipBegin = liveMarker.clipBegin ?? 0;
  const clipEnd = liveMarker.clipEnd ?? clipBegin;
  const sentenceDuration = clipEnd - clipBegin;
  if (liveMarker.wordAlignments && liveMarker.wordAlignments.length > 0) {
    return placeWordCuesOnTrack(
      liveMarker.wordAlignments,
      clipBegin,
      sentenceDuration
    );
  }
  if (liveMarker.sentenceText) {
    return estimateWordTimings(liveMarker.sentenceText, clipBegin, clipEnd);
  }
  return undefined;
}

/** Stretch sentence-relative cues so they fill `[0, pcmDuration]`. */
export function fitWordCuesToPcmDuration(
  words: WordSyncCue[],
  pcmDuration: number
): WordSyncCue[] {
  if (words.length === 0) return words;
  const pcm = Math.max(0, pcmDuration);
  const first = Math.min(pcm, Math.max(0, wordCueStart(words[0])));
  const last = words[words.length - 1];
  const lastEnd = Math.max(first, wordCueStart(last), wordCueEnd(last));
  const srcSpan = Math.max(1e-6, lastEnd - first);
  const destSpan = Math.max(0, pcm - first);
  const scale = destSpan / srcSpan;
  const fitted = words.map((word) => ({
    word: word.word,
    startSec: first + (wordCueStart(word) - first) * scale,
    endSec: first + (wordCueEnd(word) - first) * scale,
  }));
  return clampWordCues(fitted, 0, pcm);
}

/** Stretch chapter-absolute cues so they fill `[lo, hi]`. */
export function fitWordCuesToRange(
  words: WordSyncCue[],
  lo: number,
  hi: number
): WordSyncCue[] {
  if (words.length === 0) return words;
  const spanLo = Math.min(lo, hi);
  const spanHi = Math.max(lo, hi);
  const first = Math.min(spanHi, Math.max(spanLo, wordCueStart(words[0])));
  const lastEnd = Math.max(
    first,
    wordCueStart(words[words.length - 1]),
    wordCueEnd(words[words.length - 1])
  );
  const srcSpan = Math.max(1e-6, lastEnd - first);
  const destSpan = Math.max(0, spanHi - first);
  const scale = destSpan / srcSpan;
  const fitted = words.map((word) => ({
    word: word.word,
    startSec: first + (wordCueStart(word) - first) * scale,
    endSec: first + (wordCueEnd(word) - first) * scale,
  }));
  return clampWordCues(fitted, spanLo, spanHi);
}

/** Place sentence-relative cues onto the chapter track and fit them to PCM duration. */
export function placeWordCuesOnTrack(
  words: WordSyncCue[],
  trackStart: number,
  sentenceDuration: number
): WordSyncCue[] {
  const duration = Math.max(0, sentenceDuration);
  return clampWordCues(
    offsetWords(fitWordCuesToPcmDuration(words, duration), trackStart),
    trackStart,
    trackStart + duration
  );
}

/**
 * Resolve the sentence/word to highlight for playback time `t`.
 * Same `t` yields the same marker for play-through and scrub jumps.
 */
export function resolvePlaybackMarker(
  input: ResolvePlaybackInput
): PlaybackMarker | null {
  const { time, segments, liveMarker, isLiveTrack } = input;

  if (isLiveTrack && liveMarker) {
    const sentenceId =
      liveMarker.textElementId || liveMarker.smilId || undefined;
    if (sentenceId) {
      const words = liveWordsForMarker(liveMarker);
      const wordIndex = words
        ? findWordAtTime(words, time)
        : liveMarker.currentWordIndex;

      return {
        time,
        sentenceId,
        chapterHref: liveMarker.chapterHref,
        wordIndex,
        sentenceText: liveMarker.sentenceText,
        words,
        clipBegin: liveMarker.clipBegin,
        clipEnd: liveMarker.clipEnd,
      };
    }
  }

  const segment = findSegmentAtTime(segments, time);
  if (!segment) return null;

  const words =
    segment.words && segment.words.length > 0
      ? fitWordCuesToRange(segment.words, segment.clipBegin, segment.clipEnd)
      : undefined;

  return {
    time,
    sentenceId: segment.textElementId,
    chapterHref: segment.chapterHref,
    wordIndex: findWordAtTime(words, time),
    words,
    clipBegin: segment.clipBegin,
    clipEnd: segment.clipEnd,
  };
}

function offsetWords(words: WordSyncCue[], offset: number): WordSyncCue[] {
  if (offset === 0) return words;
  return words.map((word) => ({
    word: word.word,
    startSec: wordCueStart(word) + offset,
    endSec: wordCueEnd(word) + offset,
  }));
}

/** Whether playback time advanced enough to warrant another sync pass. */
export function shouldRunSyncPass(
  currentTime: number,
  lastSyncTime: number,
  epsilon = SYNC_TIME_EPSILON
): boolean {
  return Math.abs(currentTime - lastSyncTime) >= epsilon;
}

export interface ViewportOffsets {
  topOffset: number;
  bottomOffset: number;
}

/**
 * Whether an element is fully visible in the scroll container viewport,
 * accounting for header (top) and floating player (bottom) chrome.
 */
export function isElementFullyVisible(
  elementRect: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  containerRect: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  offsets: ViewportOffsets
): boolean {
  return (
    elementRect.top >= containerRect.top + offsets.topOffset &&
    elementRect.bottom <= containerRect.bottom - offsets.bottomOffset &&
    elementRect.left >= containerRect.left &&
    elementRect.right <= containerRect.right
  );
}

/**
 * Target scrollTop to place the element just below the header, clamped to content.
 */
export function clampScrollTopForElement(
  elementOffsetTop: number,
  containerOffsetTop: number,
  containerHeight: number,
  scrollHeight: number,
  offsets: ViewportOffsets,
  paddingPx = 8
): number {
  const targetScrollTop =
    elementOffsetTop - containerOffsetTop - offsets.topOffset - paddingPx;
  const maxScrollTop =
    scrollHeight - containerHeight + offsets.bottomOffset;
  return Math.min(Math.max(0, targetScrollTop), maxScrollTop);
}

/**
 * Target scrollTop from the element's current viewport box. Use this for nested
 * word spans whose `offsetTop` is not relative to the scroll container.
 */
export function scrollTopToRevealRect(
  currentScrollTop: number,
  elementTop: number,
  containerTop: number,
  containerHeight: number,
  scrollHeight: number,
  offsets: ViewportOffsets,
  paddingPx = 8
): number {
  const targetScrollTop =
    currentScrollTop +
    (elementTop - containerTop) -
    offsets.topOffset -
    paddingPx;
  const maxScrollTop =
    scrollHeight - containerHeight + offsets.bottomOffset;
  return Math.min(Math.max(0, targetScrollTop), maxScrollTop);
}

export function isFollowScrollPaused(
  lastUserScrollAt: number | null,
  now: number,
  resumeMs = AUTO_SCROLL_RESUME_MS
): boolean {
  if (lastUserScrollAt === null) return false;
  return now - lastUserScrollAt < resumeMs;
}

export function hasNonCollapsedTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(
    selection && selection.rangeCount > 0 && !selection.isCollapsed
  );
}
