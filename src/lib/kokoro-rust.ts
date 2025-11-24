import { invoke } from "@tauri-apps/api/core";
import type { VoiceId } from "../types/reader";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readDir } from "@tauri-apps/plugin-fs";

let engineInitialized = false;

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
    
    // Try CoreML models first (for macOS/iOS), fallback to ONNX
    // Rust will handle platform detection and use the appropriate model type
    let modelPath = `${dataDirPath}kokoro-coreml-models`;
    const voicesPath = `${dataDirPath}voices-v1.0.bin`;

    // Check if CoreML models directory exists
    if (!(await exists(modelPath))) {
      // Try to copy from bundled resources first
      const coremlModels = [
        "kokoro_duration.mlpackage",
        "kokoro_decoder_only_3s.mlpackage",
        "kokoro_decoder_only_5s.mlpackage",
        "kokoro_decoder_only_10s.mlpackage",
        "kokoro_synthesizer_3s.mlpackage",
        "kokoro_synthesizer_3s_nolstm.mlpackage",
        "kokoro_f0n_3s.mlpackage",
      ];
      
      let foundAny = false;
      // Try to copy each model from bundled resources
      for (const modelName of coremlModels) {
        try {
          const targetPath = await join(modelPath, modelName);
          
          // Try to copy from bundled resources
          try {
            await invoke("copy_directory", {
              sourcePath: `resources/${modelName}`,
              targetPath,
            });
            console.log(`Copied CoreML model from bundle: ${modelName}`);
            foundAny = true;
          } catch (e) {
            // Model might not be in bundle, try from project directory (dev mode)
            console.log(`Model ${modelName} not in bundle, trying project directory...`);
          }
        } catch (e) {
          // Continue to next model
        }
      }
      
      // If no models found in bundle, try project directory (dev mode)
      if (!foundAny) {
        const possibleSourceDirs: string[] = [];
        
        // Try relative to app data dir (go up to find project)
        try {
          const homeDir = dataDir.split("/Library/Application Support")[0];
          possibleSourceDirs.push(
            await join(homeDir, "Documents", "tts-tauri", "kokoro-coreml", "coreml")
          );
        } catch (e) {
          // Ignore
        }
        
        // Try relative to current working directory (if available)
        try {
          const { resolve } = await import("@tauri-apps/api/path");
          possibleSourceDirs.push(await resolve("../kokoro-coreml/coreml"));
        } catch (e) {
          // Ignore
        }
        
        let sourceDir: string | null = null;
        for (const dir of possibleSourceDirs) {
          if (await exists(dir)) {
            // Verify it has .mlpackage files
            try {
              const entries = await readDir(dir);
              const hasModels = entries.some((e: any) => 
                e.name?.endsWith(".mlpackage")
              );
              if (hasModels) {
                sourceDir = dir;
                break;
              }
            } catch (e) {
              // Continue
            }
          }
        }
        
        if (sourceDir) {
          // Copy all .mlpackage files from project directory
          const entries = await readDir(sourceDir);
          for (const entry of entries) {
            if (entry.name?.endsWith(".mlpackage")) {
              const sourcePath = await join(sourceDir, entry.name);
              const targetPath = await join(modelPath, entry.name);
              await invoke("copy_directory", {
                sourcePath,
                targetPath,
              });
              console.log(`Copied CoreML model from project: ${entry.name}`);
            }
          }
        } else {
          // Fallback to ONNX model if CoreML not found
          modelPath = `${dataDirPath}kokoro-v1.0.onnx`;
          
          if (!(await exists(modelPath))) {
            // Copy model file from bundled resources
            await invoke("copy_resource_file", {
              resourcePath: "kokoro-v1.0.onnx",
              targetPath: modelPath,
            });
          }
        }
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
  } catch (error) {
    console.error("Failed to initialize Kokoros engine:", error);
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

