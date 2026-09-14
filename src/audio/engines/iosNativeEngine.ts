import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { clearMediaSession } from "../mediaSession";
import type {
  EngineEvent,
  LiveStatus,
  LoadLiveOptions,
  LoadTrackOptions,
  PlaybackEngine,
} from "../types";

type Listener = (event: EngineEvent) => void;

/**
 * iOS native AVPlayer bridge — audible source of truth for background / Control Center.
 */
export function createIosNativeEngine(): PlaybackEngine {
  const listeners = new Set<Listener>();
  let nativeTime = 0;
  let playing = false;
  let unlisten: (() => void) | null = null;
  let pollId: number | null = null;
  let bridgeStarted = false;
  let destroyed = false;

  const emit = (event: EngineEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const syncPlayingFromNative = async () => {
    if (destroyed) return;
    try {
      const next = await invoke<boolean>("ios_player_is_playing");
      if (destroyed || next === playing) return;
      playing = next;
      emit({ type: next ? "play" : "pause" });
    } catch {
      // Native bridge unavailable — keep last known state.
    }
  };

  const ensureNativeBridge = () => {
    if (bridgeStarted || destroyed) return;
    bridgeStarted = true;
    // Clear web Media Session so it cannot fight MPRemoteCommandCenter.
    clearMediaSession();

    void listen<{ type: string; time?: number }>("native-player-event", (event) => {
      const { type, time } = event.payload;
      if (type === "play") {
        playing = true;
        emit({ type: "play" });
      } else if (type === "pause") {
        playing = false;
        emit({ type: "pause" });
      } else if (type === "ended") {
        playing = false;
        emit({ type: "ended" });
      } else if (type === "next") {
        emit({ type: "next" });
      } else if (type === "prev") {
        emit({ type: "prev" });
      } else if (
        (type === "timeUpdate" || type === "seek") &&
        typeof time === "number" &&
        Number.isFinite(time)
      ) {
        nativeTime = time;
        if (type === "timeUpdate") {
          playing = true;
          emit({ type: "timeUpdate", time });
        } else {
          emit({ type: "seek", time });
        }
      } else if (
        type === "durationUpdate" &&
        typeof time === "number" &&
        Number.isFinite(time)
      ) {
        emit({ type: "durationUpdate", time });
      }
    }).then((fn) => {
      if (destroyed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    if (typeof window !== "undefined") {
      void syncPlayingFromNative();
      pollId = window.setInterval(() => {
        void syncPlayingFromNative();
      }, 1000);
    }
  };

  return {
    kind: "ios-native",

    async load(options: LoadTrackOptions) {
      ensureNativeBridge();
      nativeTime = 0;
      playing = false;
      await invoke("ios_player_load", {
        options: {
          bookId: options.bookId,
          trackId: options.trackId,
          title: options.title,
          artist: options.artist,
          duration: options.duration,
          coverUrl: options.coverUrl ?? null,
        },
      });
      if (options.playbackRate && options.playbackRate > 0) {
        await invoke("ios_player_set_rate", { rate: options.playbackRate });
      }
    },

    async loadLive(options: LoadLiveOptions): Promise<LiveStatus> {
      ensureNativeBridge();
      nativeTime = 0;
      const status = await invoke<LiveStatus>("ios_player_load_live", {
        options: {
          bookId: options.bookId,
          chapterIndex: options.chapterIndex,
          title: options.title,
          artist: options.artist,
          coverUrl: options.coverUrl ?? null,
        },
      });
      return status;
    },

    async refreshLive(bookId: string, chapterIndex: number): Promise<LiveStatus> {
      return invoke<LiveStatus>("ios_player_refresh_live", {
        bookId,
        chapterIndex,
      });
    },

    async setExpectsMore(expectsMore: boolean) {
      await invoke("ios_player_set_expects_more", { expectsMore });
    },

    async play() {
      ensureNativeBridge();
      await invoke("ios_player_play");
      // Optimistically sync UI; Control Center / timeControlStatus may also emit.
      if (!playing) {
        playing = true;
        emit({ type: "play" });
      }
    },

    async pause() {
      await invoke("ios_player_pause");
      if (playing) {
        playing = false;
        emit({ type: "pause" });
      }
    },

    async seek(seconds: number) {
      const target = Math.max(0, seconds);
      nativeTime = target;
      await invoke("ios_player_seek", { seconds: target });
    },

    async setRate(rate: number) {
      await invoke("ios_player_set_rate", { rate });
    },

    getCurrentTime() {
      return nativeTime;
    },

    isPlaying() {
      return playing;
    },

    subscribe(listener: Listener) {
      ensureNativeBridge();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    destroy() {
      destroyed = true;
      listeners.clear();
      if (pollId != null) {
        window.clearInterval(pollId);
        pollId = null;
      }
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
      void invoke("ios_player_pause").catch(() => undefined);
      void invoke("ios_player_set_expects_more", { expectsMore: false }).catch(
        () => undefined
      );
    },
  };
}
