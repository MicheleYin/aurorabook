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
