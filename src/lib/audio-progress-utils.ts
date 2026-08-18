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
  | { type: "ended" };

/**
 * Applies a native-player-event payload to local playback state.
 * Returns the next native time (if updated) and whether to synthesise `<audio>` `ended`.
 */
export function applyNativePlayerEvent(
  event: { type: string; time?: number },
  webViewCurrentTime: number | null
): {
  nativeTime: number | null;
  seekWebViewTo: number | null;
  synthesiseEnded: boolean;
} {
  if (
    (event.type === "timeUpdate" || event.type === "seek") &&
    event.time !== undefined
  ) {
    const seekWebViewTo =
      event.type === "seek" &&
      webViewCurrentTime !== null &&
      shouldMirrorNativeSeek(webViewCurrentTime, event.time)
        ? event.time
        : null;
    return {
      nativeTime: event.time,
      seekWebViewTo,
      synthesiseEnded: false,
    };
  }

  if (event.type === "ended") {
    return {
      nativeTime: null,
      seekWebViewTo: null,
      synthesiseEnded: true,
    };
  }

  return {
    nativeTime: null,
    seekWebViewTo: null,
    synthesiseEnded: false,
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
