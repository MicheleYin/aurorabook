import { KokoroTTS } from "kokoro-js";
import type { VoiceId } from "../types/reader";

let ttsInstance: KokoroTTS | null = null;
let engineInitialized = false;

/**
 * Reset the engine initialization flag (useful for debugging or re-initialization)
 */
export function resetEngineInitialization(): void {
  engineInitialized = false;
  ttsInstance = null;
}

/**
 * Initialize the Kokoro JS engine with WebGPU support
 * Falls back to WASM if WebGPU is not available
 */
export async function initKokorosEngine(): Promise<void> {
  if (engineInitialized && ttsInstance) {
    return;
  }

  try {
    // Check for WebGPU support
    const webgpuSupported = 
      typeof navigator !== "undefined" &&
      "gpu" in navigator &&
      // @ts-ignore - WebGPU API may not be in types yet
      navigator.gpu !== undefined;

    console.log(`WebGPU support: ${webgpuSupported ? "Yes" : "No"}`);

    // Try WebGPU first, fallback to WASM
    const device = webgpuSupported ? "webgpu" : "wasm";
    const dtype = "q4"; // Use quantized 4-bit model for smaller size (~20MB vs ~164MB)

    console.log(`Initializing Kokoro TTS with device: ${device}, dtype: ${dtype}`);

    // Use the ONNX model from Hugging Face
    const modelId = "onnx-community/Kokoro-82M-v1.0-ONNX";
    
    ttsInstance = await KokoroTTS.from_pretrained(modelId, {
      device,
      dtype,
      progress_callback: (progressInfo) => {
        if (progressInfo.status === "progress" && progressInfo.progress % 10 < 1) {
          console.log(`Loading Kokoro model: ${progressInfo.progress.toFixed(1)}%`);
        }
      },
    });

    engineInitialized = true;
    console.log(`✅ Kokoro JS engine initialized successfully (${device})`);
  } catch (error) {
    console.error("Failed to initialize Kokoro JS engine:", error);
    engineInitialized = false;
    ttsInstance = null;
    throw error;
  }
}

/**
 * Generate TTS audio using Kokoro JS implementation
 */
export async function generateTTS(
  text: string,
  voiceId: VoiceId,
  _language?: string, // Not used by kokoro-js (voice determines language)
  speed?: number,
): Promise<{ audio: Float32Array; sampleRate: number }> {
  // Ensure engine is initialized
  if (!engineInitialized || !ttsInstance) {
    await initKokorosEngine();
  }

  if (!ttsInstance) {
    throw new Error("Kokoro TTS engine not initialized");
  }

  try {
    // Generate audio using kokoro-js
    // Cast voiceId to the expected type (kokoro-js expects specific voice IDs)
    const rawAudio = await ttsInstance.generate(text, {
      voice: voiceId as any, // kokoro-js has strict voice types, but VoiceId is compatible
      speed: speed || 1.0,
    });

    // Extract audio data and sample rate from RawAudio
    // RawAudio from transformers.js has .audio (Float32Array) and .sampling_rate (number)
    const audioData = rawAudio.audio;
    const sampleRate = rawAudio.sampling_rate || 24000;

    return {
      audio: audioData,
      sampleRate,
    };
  } catch (error) {
    console.error("TTS generation failed:", error);
    throw error;
  }
}

/**
 * Generate TTS audio for multiple texts in parallel using batch processing
 * Processes texts concurrently with controlled parallelism to avoid overwhelming the browser/GPU
 */
export async function generateTTSBatch(
  texts: string[],
  voiceId: VoiceId,
  _language?: string, // Not used by kokoro-js (voice determines language)
  speed?: number,
): Promise<number[][]> {
  // Ensure engine is initialized
  if (!engineInitialized || !ttsInstance) {
    await initKokorosEngine();
  }

  if (!ttsInstance) {
    throw new Error("Kokoro TTS engine not initialized");
  }

  // Process texts in parallel batches to control memory usage
  // WebGPU can handle multiple concurrent requests, but we limit to avoid overwhelming
  const CONCURRENT_LIMIT = 10; // Process up to 10 texts concurrently
  const results: Array<{ audio: Float32Array; sampling_rate: number }> = [];

  for (let i = 0; i < texts.length; i += CONCURRENT_LIMIT) {
    const batch = texts.slice(i, i + CONCURRENT_LIMIT);
    
    // Process this batch in parallel
    const batchPromises = batch.map((text) =>
      ttsInstance!.generate(text, {
        voice: voiceId as any, // kokoro-js has strict voice types, but VoiceId is compatible
        speed: speed || 1.0,
      })
    );

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  // Convert RawAudio to PCM bytes (16-bit little-endian)
  return results.map((rawAudio) => {
    const audioData = rawAudio.audio;
    const numSamples = audioData.length;
    const view = new DataView(new ArrayBuffer(numSamples * 2));

    for (let i = 0; i < numSamples; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i]));
      const pcmValue = sample < 0 
        ? Math.round(sample * 32768) 
        : Math.round(sample * 32767);
      view.setInt16(i * 2, pcmValue, true); // little-endian
    }

    // Convert DataView to number array
    return Array.from(new Uint8Array(view.buffer));
  });
}

