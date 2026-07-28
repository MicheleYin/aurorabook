import type { AudioSyncSegment } from "../types/book";

export const HIGHLIGHT_CLASS = "audio-highlight";
export const HIGHLIGHT_ENTER_CLASS = "audio-highlight-enter";
export const HIGHLIGHT_ACTIVE_CLASS = "audio-highlight-active";
export const HIGHLIGHT_EXIT_CLASS = "audio-highlight-exit";

/** Minimum time delta (seconds) before re-running sync highlight logic. */
export const SYNC_TIME_EPSILON = 0.1;

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

/** Active sync segment for the current playback time (inclusive clip bounds). */
export function findSegmentAtTime(
  segments: AudioSyncSegment[],
  currentTime: number
): AudioSyncSegment | undefined {
  return segments.find(
    (segment) =>
      currentTime >= segment.clipBegin && currentTime <= segment.clipEnd
  );
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
