import { DEFAULT_KOKORO_MODEL_ID, KOKORO_VOICE_GROUPS } from "../constants/kokoro";
import type { VoiceId } from "../types/reader";
import { ensureKokoroAssetFetchCache, isAssetCached } from "./kokoro-cache";

const MODEL_FETCH_OPTIONS = {
  dtype: "q8" as const,
  device: "wasm" as const,
};

const VOICE_BASE_URL =
  "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices";

export type VoicePrefetchProgress = {
  completed: number;
  total: number;
  voiceId: VoiceId;
  skipped: boolean;
};

export const prefetchKokoroModel = async () => {
  await ensureKokoroAssetFetchCache();

  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained(DEFAULT_KOKORO_MODEL_ID, MODEL_FETCH_OPTIONS);
  // Dispose references so memory can be reclaimed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void tts;
};

export const prefetchKokoroVoices = async (options?: {
  onProgress?: (progress: VoicePrefetchProgress) => void;
}) => {
  await ensureKokoroAssetFetchCache();

  const voiceIds = Array.from(
    new Set(KOKORO_VOICE_GROUPS.flatMap((group) => group.voices.map((voice) => voice.id))),
  );

  const total = voiceIds.length;
  let completed = 0;

  for (const voiceId of voiceIds) {
    const voiceUrl = `${VOICE_BASE_URL}/${voiceId}.bin`;
    const cached = await isAssetCached(voiceUrl);
    let skipped = false;

    if (!cached) {
      const response = await fetch(voiceUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch voice ${voiceId}`);
      }
      // Response is cached in ensureKokoroAssetFetchCache wrapper.
      await response.arrayBuffer();
    } else {
      skipped = true;
    }

    completed += 1;
    options?.onProgress?.({ completed, total, voiceId, skipped });
  }
};
