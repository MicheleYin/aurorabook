import { KOKORO_VOICE_GROUPS } from "../constants/kokoro";
import type { VoiceId } from "../types/reader";
import { initKokorosEngine } from "./kokoro-rust";

export type VoicePrefetchProgress = {
  completed: number;
  total: number;
  voiceId: VoiceId;
  skipped: boolean;
};

export const prefetchKokoroModel = async () => {
  // Initialize the Rust Kokoros engine
  // This will download model and voices files if needed
  await initKokorosEngine();
};

export const prefetchKokoroVoices = async (options?: {
  onProgress?: (progress: VoicePrefetchProgress) => void;
}) => {
  // Initialize engine (downloads voices file if needed)
  await initKokorosEngine();

  // All voices are included in the voices-v1.0.bin file
  // So we just report completion for all voices
  const voiceIds = Array.from(
    new Set(KOKORO_VOICE_GROUPS.flatMap((group) => group.voices.map((voice) => voice.id))),
  );

  const total = voiceIds.length;
  let completed = 0;

  // Since all voices are in one file, we just report them as completed
  for (const voiceId of voiceIds) {
    completed += 1;
    options?.onProgress?.({ 
      completed, 
      total, 
      voiceId, 
      skipped: false // Voices file was downloaded/initialized
    });
  }
};
