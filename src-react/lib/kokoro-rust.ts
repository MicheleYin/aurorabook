import { invoke } from "@tauri-apps/api/core";

let engineInitialized = false;

/**
 * Reset the engine initialization flag (useful for debugging or re-initialization)
 */
export function resetEngineInitialization(): void {
  engineInitialized = false;
}

/**
 * Initialize the Kokoros Rust engine
 * Uses bundle resources directly - no file system access needed
 */
export async function initKokorosEngine(): Promise<void> {
  if (engineInitialized) {
    return;
  }

  try {
    // Models are accessed directly from bundle resources in Rust
    // No need to copy or specify paths - Rust code handles resource resolution
    await invoke("init_kokoros_engine", {
      modelPath: "", // Empty - Rust will find from bundle resources
      voicesPath: "", // Empty - Rust will find from bundle resources
      numInstances: 4, // 4 instances for maximum parallel processing
    });

    engineInitialized = true;
    console.log("ONNX Runtime engine initialized successfully (using bundle resources)");
  } catch (error) {
    console.error("Failed to initialize Kokoros engine:", error);
    engineInitialized = false; // Reset flag on error so we can retry
    throw error;
  }
}

