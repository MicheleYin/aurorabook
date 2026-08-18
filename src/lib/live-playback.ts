const LIVE_UNDERRUN_THRESHOLD_SEC = 0.35;

export interface LivePlaybackHoldInput {
  isLiveStream: boolean;
  chapterCompleted: boolean;
  generatedDuration: number;
  currentTime: number;
  thresholdSec?: number;
}

/** Live chapter still converting (or snapshot is shorter than generated audio). */
export function shouldHoldLivePlayback(input: LivePlaybackHoldInput): boolean {
  if (!input.isLiveStream) {
    return false;
  }
  if (!input.chapterCompleted) {
    return true;
  }
  const threshold = input.thresholdSec ?? LIVE_UNDERRUN_THRESHOLD_SEC;
  return input.generatedDuration > input.currentTime + threshold;
}

export function shouldResumeLiveAfterHold(input: {
  generatedDuration: number;
  heldAtTime: number;
  thresholdSec?: number;
}): boolean {
  const threshold = input.thresholdSec ?? LIVE_UNDERRUN_THRESHOLD_SEC;
  return input.generatedDuration > input.heldAtTime + threshold;
}

/** Finite MP3 snapshot so live `<audio>` has a duration and honors playbackRate. */
export function liveStreamPlaybackUrl(
  baseUrl: string,
  now = Date.now()
): string {
  const join = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${join}snapshot=1&ts=${now}`;
}
