import { type } from "@tauri-apps/plugin-os";

import { createAndroidEngine } from "./engines/androidEngine";
import { createIosNativeEngine } from "./engines/iosNativeEngine";
import { createWebviewEngine } from "./engines/webviewEngine";
import type { PlaybackEngine } from "./types";

/**
 * Resolve the platform playback engine.
 * iOS → native AVPlayer; Android → WebView stub (future native); else → WebView + Media Session.
 */
export async function createPlaybackEngine(
  getAudio: () => HTMLAudioElement | null
): Promise<PlaybackEngine> {
  let platform: string;
  try {
    platform = await type();
  } catch {
    platform = "unknown";
  }

  switch (platform) {
    case "ios":
      return createIosNativeEngine();
    case "android":
      return createAndroidEngine(getAudio);
    default:
      return createWebviewEngine(getAudio);
  }
}
