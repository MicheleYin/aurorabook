/** MIME type for MediaSession / `<audio>` metadata from a track file href. */
export function mimeTypeFromTrackHref(href: string | undefined | null): string {
  if (href?.endsWith(".mp3")) return "audio/mpeg";
  if (href?.endsWith(".m4a")) return "audio/mp4";
  if (href?.endsWith(".ogg")) return "audio/ogg";
  if (href?.endsWith(".wav")) return "audio/wav";
  return "audio/mpeg";
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

export type NativePlayerEventResult = {
  nativeTime: number | null;
  synthesiseEnded: boolean;
  durationUpdate: number | null;
  shouldNext: boolean;
  shouldPrev: boolean;
  /** true = play, false = pause, null = unchanged */
  playing: boolean | null;
};

/**
 * Maps a native-player-event payload to UI / progress state.
 * Does not drive WebView media — AVPlayer is the only engine on iOS.
 */
export function applyNativePlayerEvent(
  event: { type: string; time?: number }
): NativePlayerEventResult {
  const idle: NativePlayerEventResult = {
    nativeTime: null,
    synthesiseEnded: false,
    durationUpdate: null,
    shouldNext: false,
    shouldPrev: false,
    playing: null,
  };

  if (event.type === "play") {
    return { ...idle, playing: true };
  }

  if (event.type === "pause") {
    return { ...idle, playing: false };
  }

  if (event.type === "next") {
    return { ...idle, shouldNext: true };
  }

  if (event.type === "prev") {
    return { ...idle, shouldPrev: true };
  }

  if (
    (event.type === "timeUpdate" || event.type === "seek") &&
    event.time !== undefined
  ) {
    return { ...idle, nativeTime: event.time };
  }

  if (event.type === "durationUpdate" && event.time !== undefined) {
    return { ...idle, durationUpdate: event.time };
  }

  if (event.type === "ended") {
    return { ...idle, synthesiseEnded: true, playing: false };
  }

  return idle;
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
