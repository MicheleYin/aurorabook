/** MIME type for MediaSession / `<audio>` metadata from a track file href. */
export function mimeTypeFromTrackHref(href: string | undefined | null): string {
  if (href?.endsWith(".mp3")) return "audio/mpeg";
  if (href?.endsWith(".m4a")) return "audio/mp4";
  if (href?.endsWith(".ogg")) return "audio/ogg";
  if (href?.endsWith(".wav")) return "audio/wav";
  return "audio/mpeg";
}

/**
 * Whether a lock-screen / native seek should be mirrored onto the WebView `<audio>`.
 * Avoids fighting tiny float differences between AVPlayer and HTMLMediaElement.
 */
export function shouldMirrorNativeSeek(
  webViewCurrentTime: number,
  nativeTime: number,
  thresholdSeconds = 1
): boolean {
  return Math.abs(webViewCurrentTime - nativeTime) > thresholdSeconds;
}

export type NativePlayerEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; time: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "timeUpdate"; time: number }
  | { type: "ended" }
  | { type: "durationUpdate"; time: number };

/**
 * Applies a native-player-event payload to local playback state.
 * Returns the next native time (if updated), WebView sync actions, and duration.
 */
export function applyNativePlayerEvent(
  event: { type: string; time?: number },
  webViewCurrentTime: number | null
): {
  nativeTime: number | null;
  seekWebViewTo: number | null;
  synthesiseEnded: boolean;
  shouldPlay: boolean;
  shouldPause: boolean;
  durationUpdate: number | null;
  shouldNext: boolean;
  shouldPrev: boolean;
} {
  if (event.type === "play") {
    return {
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: false,
      shouldPlay: true,
      shouldPause: false,
      durationUpdate: null,
      shouldNext: false,
      shouldPrev: false,
    };
  }

  if (event.type === "pause") {
    return {
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: false,
      shouldPlay: false,
      shouldPause: true,
      durationUpdate: null,
      shouldNext: false,
      shouldPrev: false,
    };
  }

  if (event.type === "next") {
    return {
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: false,
      shouldPlay: false,
      shouldPause: false,
      durationUpdate: null,
      shouldNext: true,
      shouldPrev: false,
    };
  }

  if (event.type === "prev") {
    return {
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: false,
      shouldPlay: false,
      shouldPause: false,
      durationUpdate: null,
      shouldNext: false,
      shouldPrev: true,
    };
  }

  if (
    (event.type === "timeUpdate" || event.type === "seek") &&
    event.time !== undefined
  ) {
    // Always push native clock onto the (muted) WebView element on iOS so UI/state stay in sync.
    const seekWebViewTo =
      event.type === "seek" && webViewCurrentTime !== null
        ? shouldMirrorNativeSeek(webViewCurrentTime, event.time)
          ? event.time
          : null
        : event.time;
    return {
      nativeTime: event.time,
      seekWebViewTo,
      synthesiseEnded: false,
      shouldPlay: false,
      shouldPause: false,
      durationUpdate: null,
      shouldNext: false,
      shouldPrev: false,
    };
  }

  if (event.type === "durationUpdate" && event.time !== undefined) {
    return {
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: false,
      shouldPlay: false,
      shouldPause: false,
      durationUpdate: event.time,
      shouldNext: false,
      shouldPrev: false,
    };
  }

  if (event.type === "ended") {
    return {
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: true,
      shouldPlay: false,
      shouldPause: false,
      durationUpdate: null,
      shouldNext: false,
      shouldPrev: false,
    };
  }

  return {
    nativeTime: null,
    seekWebViewTo: null,
    synthesiseEnded: false,
    shouldPlay: false,
    shouldPause: false,
    durationUpdate: null,
    shouldNext: false,
    shouldPrev: false,
  };
}

/** Resume saved position after server restart; optionally continue playing. */
export function canRestoreSavedTime(
  savedTime: number,
  duration: number
): boolean {
  return Number.isFinite(savedTime) && savedTime >= 0 && savedTime < duration;
}

/** Apply speed so `load()` cannot reset the element back to 1x. */
export function applyMediaPlaybackRate(
  media: Pick<HTMLMediaElement, "playbackRate" | "defaultPlaybackRate">,
  rate: number
): number {
  const nextRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  media.defaultPlaybackRate = nextRate;
  media.playbackRate = nextRate;
  return nextRate;
}

export function trackDisplayTitle(
  title: string | undefined | null,
  order: number
): string {
  return title || `Track ${order + 1}`;
}
