import { logger } from "../lib/logger";

export const MEDIA_SKIP_EVENT = "aurora-media-skip";

export type MediaSessionAudioAdapter = {
  play: () => Promise<void> | void;
  pause: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number) => void;
  getPlaybackRate: () => number;
};

const ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "seekto",
  "seekbackward",
  "seekforward",
  "previoustrack",
  "nexttrack",
];

let bound = false;

function getSession(): MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return null;
  }
  return navigator.mediaSession;
}

function dispatchSkip(direction: "next" | "prev") {
  window.dispatchEvent(
    new CustomEvent(MEDIA_SKIP_EVENT, { detail: direction })
  );
  // Backward-compatible alias used by the floating player skip listener.
  window.dispatchEvent(
    new CustomEvent("aurora-native-skip", { detail: direction })
  );
}

/**
 * Register Control Center / Now Playing action handlers for WebView playback.
 * Required on macOS WKWebView once MediaMetadata is set.
 */
export function bindMediaSessionControls(
  adapter: MediaSessionAudioAdapter
): void {
  const session = getSession();
  if (!session) return;

  unbindMediaSessionControls();

  try {
    session.setActionHandler("play", () => {
      void Promise.resolve(adapter.play()).catch((err: unknown) => {
        logger.warn("[media-session] play failed:", err);
      });
    });
    session.setActionHandler("pause", () => {
      adapter.pause();
    });
    session.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number" && Number.isFinite(details.seekTime)) {
        adapter.seekTo(details.seekTime);
      }
    });
    session.setActionHandler("seekbackward", (details) => {
      const offset = details.seekOffset ?? 10;
      adapter.seekTo(Math.max(0, adapter.getCurrentTime() - offset));
    });
    session.setActionHandler("seekforward", (details) => {
      const offset = details.seekOffset ?? 10;
      const duration = adapter.getDuration();
      const max = Number.isFinite(duration) && duration > 0 ? duration : adapter.getCurrentTime() + offset;
      adapter.seekTo(Math.min(max, adapter.getCurrentTime() + offset));
    });
    session.setActionHandler("previoustrack", () => {
      dispatchSkip("prev");
    });
    session.setActionHandler("nexttrack", () => {
      dispatchSkip("next");
    });
    bound = true;
  } catch (err) {
    logger.warn("[media-session] failed to bind action handlers:", err);
  }
}

export function unbindMediaSessionControls(): void {
  const session = getSession();
  if (!session) return;

  for (const action of ACTIONS) {
    try {
      session.setActionHandler(action, null);
    } catch {
      // Some actions are unsupported on a given platform.
    }
  }
  bound = false;
}

export function setMediaSessionPlaybackState(
  state: MediaSessionPlaybackState
): void {
  const session = getSession();
  if (!session) return;
  try {
    session.playbackState = state;
  } catch {
    // Older WebViews may not support playbackState.
  }
}

export function setMediaSessionPositionState(options: {
  duration: number;
  position: number;
  playbackRate?: number;
}): void {
  const session = getSession();
  if (!session || typeof session.setPositionState !== "function") return;

  const duration = options.duration;
  const position = options.position;
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (!Number.isFinite(position) || position < 0) return;

  try {
    session.setPositionState({
      duration,
      position: Math.min(position, duration),
      playbackRate:
        options.playbackRate && options.playbackRate > 0
          ? options.playbackRate
          : 1,
    });
  } catch {
    // Ignore invalid position state combinations.
  }
}

export function clearMediaSession(): void {
  unbindMediaSessionControls();
  const session = getSession();
  if (!session) return;
  try {
    session.metadata = null;
    session.playbackState = "none";
  } catch {
    // ignore
  }
}

export function isMediaSessionBound(): boolean {
  return bound;
}
