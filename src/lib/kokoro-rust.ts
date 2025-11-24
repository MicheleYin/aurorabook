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
 * Uses ONNX Runtime with CPU execution provider
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
    
    // ONNX model file path
    const onnxModelPath = `${dataDirPath}kokoro-v1.0.onnx`;
    const voicesPath = `${dataDirPath}voices-v1.0.bin`;
    
    // Check if ONNX model exists, if not try to copy from resources
    if (!(await exists(onnxModelPath))) {
      try {
        await invoke("copy_resource_file", {
          resourcePath: "kokoro-v1.0.onnx",
          targetPath: onnxModelPath,
        });
        console.log("Copied ONNX model from bundle");
      } catch (e) {
        console.error("Failed to copy ONNX model from bundle:", e);
        engineInitialized = false;
        throw new Error(`ONNX model not found. Please ensure kokoro-v1.0.onnx is available in resources or at ${onnxModelPath}`);
      }
    }
    
    // Check if voices file exists, if not try to copy from resources
    if (!(await exists(voicesPath))) {
      try {
        await invoke("copy_resource_file", {
          resourcePath: "voices-v1.0.bin",
          targetPath: voicesPath,
        });
        console.log("Copied voices file from bundle");
      } catch (e) {
        console.error("Failed to copy voices file from bundle:", e);
        engineInitialized = false;
        throw new Error(`Voices file not found. Please ensure voices-v1.0.bin is available in resources or at ${voicesPath}`);
      }
    }

    // Initialize the ONNX Runtime engine (CPU execution provider)
    // Use 4 instances for better throughput
    await invoke("init_kokoros_engine", {
      modelPath: onnxModelPath,
      voicesPath: voicesPath,
      numInstances: 4, // 4 instances for maximum parallel processing
    });

    engineInitialized = true;
    console.log("ONNX Runtime engine initialized successfully (CPU execution provider)");
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

