import { applyMediaPlaybackRate } from "../../lib/audio-progress-utils";
import { logger } from "../../lib/logger";
import {
  bindMediaSessionControls,
  clearMediaSession,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
  unbindMediaSessionControls,
} from "../mediaSession";
import type {
  EngineEvent,
  LoadTrackOptions,
  PlaybackEngine,
} from "../types";

type Listener = (event: EngineEvent) => void;

/**
 * Desktop / WebView playback: HTMLAudioElement + Media Session (macOS/Windows).
 */
export function createWebviewEngine(
  getAudio: () => HTMLAudioElement | null
): PlaybackEngine {
  const listeners = new Set<Listener>();
  let destroyed = false;
  let pendingLoad: LoadTrackOptions | null = null;
  const cleanups: Array<() => void> = [];

  const emit = (event: EngineEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const applyLoad = (audio: HTMLAudioElement, options: LoadTrackOptions) => {
    if (!options.streamUrl) {
      throw new Error("streamUrl is required for webview engine load");
    }

    audio.muted = false;
    audio.volume = 1;
    audio.src = options.streamUrl;
    audio.load();
    if (!audio.paused) {
      audio.pause();
    }
    audio.currentTime = 0;
    applyMediaPlaybackRate(audio, options.playbackRate ?? 1);
  };

  const attachElementListeners = (audio: HTMLAudioElement) => {
    const onPlay = () => {
      setMediaSessionPlaybackState("playing");
      emit({ type: "play" });
    };
    const onPause = () => {
      setMediaSessionPlaybackState("paused");
      emit({ type: "pause" });
    };
    const onTimeUpdate = () => {
      const time = audio.currentTime;
      emit({ type: "timeUpdate", time });
      setMediaSessionPositionState({
        duration: audio.duration,
        position: time,
        playbackRate: audio.playbackRate,
      });
    };
    const onSeeked = () => {
      emit({ type: "seek", time: audio.currentTime });
    };
    const onEnded = () => {
      setMediaSessionPlaybackState("paused");
      emit({ type: "ended" });
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        emit({ type: "durationUpdate", time: audio.duration });
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    cleanups.push(() => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    });
  };

  const ensureListeners = () => {
    const audio = getAudio();
    if (!audio || destroyed) return;
    // Attach once per element instance.
    if ((audio as HTMLAudioElement & { __auroraEngineBound?: boolean }).__auroraEngineBound) {
      if (pendingLoad) {
        const options = pendingLoad;
        pendingLoad = null;
        applyLoad(audio, options);
      }
      return;
    }
    (audio as HTMLAudioElement & { __auroraEngineBound?: boolean }).__auroraEngineBound =
      true;
    attachElementListeners(audio);
    bindMediaSessionControls({
      play: async () => {
        const el = getAudio();
        if (!el) return;
        await el.play();
      },
      pause: () => {
        getAudio()?.pause();
      },
      getCurrentTime: () => getAudio()?.currentTime ?? 0,
      getDuration: () => getAudio()?.duration ?? 0,
      seekTo: (seconds) => {
        const el = getAudio();
        if (!el) return;
        el.currentTime = Math.max(0, seconds);
      },
      getPlaybackRate: () => getAudio()?.playbackRate ?? 1,
    });
    if (pendingLoad) {
      const options = pendingLoad;
      pendingLoad = null;
      applyLoad(audio, options);
    }
  };

  return {
    kind: "webview",

    async load(options: LoadTrackOptions) {
      pendingLoad = options;
      const audio = getAudio();
      if (!audio) {
        // Floating player may not have mounted <audio> yet; apply when it appears.
        return;
      }
      ensureListeners();
      pendingLoad = null;
      applyLoad(audio, options);
    },

    async play() {
      ensureListeners();
      const audio = getAudio();
      if (!audio) return;
      await audio.play();
      setMediaSessionPlaybackState("playing");
    },

    async pause() {
      ensureListeners();
      const audio = getAudio();
      if (!audio) return;
      audio.pause();
      setMediaSessionPlaybackState("paused");
    },

    async seek(seconds: number) {
      ensureListeners();
      const audio = getAudio();
      if (!audio) return;
      const target = Math.max(0, seconds);
      try {
        audio.currentTime = target;
        emit({ type: "seek", time: target });
      } catch (err) {
        logger.warn("[webview-engine] seek failed:", err);
      }
    },

    async setRate(rate: number) {
      ensureListeners();
      const audio = getAudio();
      if (!audio) return;
      applyMediaPlaybackRate(audio, rate);
    },

    getCurrentTime() {
      return getAudio()?.currentTime ?? 0;
    },

    isPlaying() {
      const audio = getAudio();
      return Boolean(audio && !audio.paused && !audio.ended);
    },

    subscribe(listener: Listener) {
      listeners.add(listener);
      ensureListeners();
      return () => {
        listeners.delete(listener);
      };
    },

    destroy() {
      destroyed = true;
      pendingLoad = null;
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
      listeners.clear();
      unbindMediaSessionControls();
      clearMediaSession();
    },
  };
}
