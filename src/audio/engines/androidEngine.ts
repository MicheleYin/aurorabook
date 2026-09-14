import type {
  EngineEvent,
  LoadTrackOptions,
  PlaybackEngine,
} from "../types";
import { createWebviewEngine } from "./webviewEngine";

/**
 * Android stub: currently aliases the WebView engine.
 * Swap for a native ExoPlayer bridge when Android packaging lands.
 */
export function createAndroidEngine(
  getAudio: () => HTMLAudioElement | null
): PlaybackEngine {
  const webview = createWebviewEngine(getAudio);

  return {
    ...webview,
    kind: "android",
    async load(options: LoadTrackOptions) {
      return webview.load(options);
    },
    subscribe(listener: (event: EngineEvent) => void) {
      return webview.subscribe(listener);
    },
    destroy() {
      webview.destroy();
    },
  };
}
