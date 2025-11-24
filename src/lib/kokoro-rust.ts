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
    // Get or set model paths
    const dataDir = await appDataDir();
    // Ensure trailing slash
    const dataDirPath = dataDir.endsWith("/") ? dataDir : `${dataDir}/`;
    
    // CoreML models directory (FluidInference models)
    // Voices are included in the kokoro-82m-coreml/voices/ directory as JSON files
    const coremlModelDir = `${dataDirPath}kokoro-82m-coreml`;
    let modelPath: string;
    
    // Check if CoreML model directory exists
    if (await exists(coremlModelDir)) {
      modelPath = coremlModelDir;
      console.log(`Using existing CoreML models directory: ${modelPath}`);
    } else {
      // Copy CoreML models from bundled resources
      try {
        await invoke("copy_directory", {
          sourcePath: "kokoro-82m-coreml",
          targetPath: coremlModelDir,
        });
        console.log("Copied CoreML models from bundle");
        modelPath = coremlModelDir;
      } catch (e) {
        console.error("Failed to copy CoreML models from bundle:", e);
        engineInitialized = false; // Reset flag on error
        throw new Error(`CoreML models not found. Please ensure kokoro-82m-coreml directory is available in resources or at ${coremlModelDir}`);
      }
    }

    // Initialize the CoreML engine with parallel instances
    // Use 4 instances for better throughput (as recommended for Mac M2)
    // With ANE/GPU, can handle even more instances efficiently
    // Voices are loaded from JSON files in the model directory
    await invoke("init_kokoros_engine", {
      modelPath,
      voicesPath: "", // Not used for CoreML - voices are in JSON files
      numInstances: 4, // 4 instances for maximum parallel processing
    });

    engineInitialized = true;
    console.log("CoreML engine initialized successfully");
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

