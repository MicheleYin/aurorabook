import { invoke } from "@tauri-apps/api/core";
import type { VoiceId } from "../types/reader";
import { appDataDir } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";

let engineInitialized = false;

/**
 * Reset the engine initialization flag (useful for debugging or re-initialization)
 */
export function resetEngineInitialization(): void {
  engineInitialized = false;
}

/**
 * Initialize the Kokoros Rust engine
 */
export async function initKokorosEngine(): Promise<void> {
  if (engineInitialized) {
    return;
  }

  try {
    // Get or set model and voices paths
    const dataDir = await appDataDir();
    // Ensure trailing slash
    const dataDirPath = dataDir.endsWith("/") ? dataDir : `${dataDir}/`;
    
    // kokoros expects the full path to an ONNX file (not a directory)
    // ONNX Runtime with CoreML EP will use CoreML acceleration on Apple platforms
    // See: https://github.com/lucasjinreal/Kokoros and lib.rs test comments
    let modelPath = `${dataDirPath}kokoro-v1.0.onnx`;
    const voicesPath = `${dataDirPath}voices-v1.0.bin`;

    console.log(`Initializing Kokoros engine with model path: ${modelPath}`);

    // Check if ONNX model file exists, if not copy from bundled resources
    if (!(await exists(modelPath))) {
      try {
        // Copy model file from bundled resources
        await invoke("copy_resource_file", {
          resourcePath: "kokoro-v1.0.onnx",
          targetPath: modelPath,
        });
        console.log("Copied ONNX model from bundle");
      } catch (e) {
        console.error("Failed to copy ONNX model from bundle:", e);
        engineInitialized = false; // Reset flag on error
        throw new Error(`ONNX model not found. Please ensure kokoro-v1.0.onnx is available in resources or at ${modelPath}`);
      }
    }

    // Copy voices file if needed
    if (!(await exists(voicesPath))) {
      // Copy voices file from bundled resources
      await invoke("copy_resource_file", {
        resourcePath: "voices-v1.0.bin",
        targetPath: voicesPath,
      });
    }

    // Initialize the engine with parallel instances
    // Use 4 instances for better throughput (as recommended for Mac M2 in kokoros docs)
    // With GPU/ANE, can handle even more instances efficiently
    // On Apple platforms, this will use CoreML models if available
    await invoke("init_kokoros_engine", {
      modelPath,
      voicesPath,
      numInstances: 4, // 4 instances for maximum parallel processing
    });

    engineInitialized = true;
    console.log("Kokoros engine initialized successfully");
  } catch (error) {
    console.error("Failed to initialize Kokoros engine:", error);
    engineInitialized = false; // Reset flag on error so we can retry
    throw error;
  }
}

/**
 * Generate TTS audio using Kokoros Rust implementation
 */
export async function generateTTS(
  text: string,
  voiceId: VoiceId,
  language?: string,
  speed?: number,
): Promise<{ audio: Float32Array; sampleRate: number }> {
  // Ensure engine is initialized
  if (!engineInitialized) {
    await initKokorosEngine();
  }

  // Call Tauri command - returns Vec<u8> as number array
  const pcmBytes = await invoke<number[]>("generate_tts_cached", {
    text,
    voiceId,
    language: language || "en",
    speed: speed || 1.0,
  });

  // Convert number array to Uint8Array, then to Float32Array
  // PCM bytes are 16-bit little-endian samples
  const pcmArray = new Uint8Array(pcmBytes);
  const numSamples = pcmArray.length / 2;
  const audioData = new Float32Array(numSamples);
  const view = new DataView(pcmArray.buffer);

  for (let i = 0; i < numSamples; i++) {
    const pcmValue = view.getInt16(i * 2, true); // little-endian
    // Convert from 16-bit PCM to float32 [-1.0, 1.0]
    audioData[i] = pcmValue / (pcmValue < 0 ? 32768.0 : 32767.0);
  }

  return {
    audio: audioData,
    sampleRate: 24000, // Kokoros uses 24kHz
  };
}

/**
 * Generate TTS audio for multiple texts in parallel using batch processing
 */
export async function generateTTSBatch(
  texts: string[],
  voiceId: VoiceId,
  language?: string,
  speed?: number,
): Promise<number[][]> {
  // Ensure engine is initialized
  if (!engineInitialized) {
    await initKokorosEngine();
  }

  // Call Tauri batch command - returns array of PCM byte arrays
  const results = await invoke<number[][]>("generate_tts_batch", {
    texts,
    voiceId,
    language: language || "en",
    speed: speed || 1.0,
  });

  return results;
}

