# CoreML Migration Status

This document tracks the migration from ONNX-based Kokoro TTS to FluidInference CoreML models.

## ✅ Completed

1. **Dependencies Added**:
   - Added `objc2-core-ml`, `objc2-foundation`, and `objc2` to `Cargo.toml` for macOS/iOS platforms
   - These provide Rust bindings for CoreML framework

2. **CoreML Module Created**:
   - Created `src-tauri/src/kokoro_coreml.rs` module
   - Implemented `KokoroCoreML` and `KokoroCoreMLParallel` structs
   - Added model directory detection and loading logic
   - Supports both `.mlpackage` and `.mlmodelc` formats

3. **Initialization Updated**:
   - Updated `init_kokoros_engine` in `lib.rs` to detect CoreML model directories
   - Automatically uses CoreML models if `.mlpackage` files are found
   - Falls back to ONNX/kokoros if CoreML models are not available

4. **TypeScript Integration**:
   - Updated `src/lib/kokoro-rust.ts` to check for CoreML model directory
   - Checks for `kokoro-82m-coreml` directory in app data directory
   - Falls back to ONNX model if CoreML directory not found

5. **Resource Bundling**:
   - Updated `tauri.conf.json` to include CoreML models directory
   - Added `../kokoro-82m-coreml/**/*` to resources

## ⚠️ In Progress / TODO

### Critical: CoreML Model Loading Implementation

The CoreML model loading function (`load_model`) is currently a placeholder. It needs:

1. **Proper NSURL Creation**:
   - Use `NSURL::fileURLWithPath_isDirectory` correctly
   - Handle Objective-C memory management with autoreleasepool

2. **MLModel Loading**:
   - Call `MLModel::modelWithContentsOfURL_configuration_error` properly
   - Handle NSError return values
   - Configure MLModelConfiguration for ANE/GPU acceleration

3. **Error Handling**:
   - Properly extract error messages from NSError
   - Handle model loading failures gracefully

### TTS Pipeline Implementation

Once models are loaded, the full TTS pipeline needs to be implemented:

1. **Text Preprocessing**:
   - Phoneme conversion (grapheme-to-phoneme)
   - Tokenization using vocab_index.json
   - Text normalization

2. **Voice Loading**:
   - Load voice embeddings from JSON files in `voices/` directory
   - Extract voice reference embeddings (`ref_s`)

3. **Duration Prediction**:
   - Load duration prediction model (if available)
   - Prepare inputs: `input_ids`, `attention_mask`, `ref_s`, `speed`
   - Run inference and extract duration predictions

4. **Synthesizer Inference**:
   - Select appropriate bucket model based on text duration:
     - `kokoro_21_5s` for short texts (< 5s)
     - `kokoro_21_10s` or `kokoro_24_10s` for medium texts (5-10s)
     - `kokoro_21_15s` or `kokoro_24_15s` for longer texts (10-15s)
   - Prepare inputs: `asr`, `F0_pred`, `N_pred`, `ref_s`
   - Run synthesizer inference
   - Extract waveform output

5. **Audio Post-processing**:
   - Convert waveform to audio samples
   - Apply normalization
   - Return as Float32Array

## Alternative Approaches

### Option 1: Complete Rust Implementation
- Implement full TTS pipeline in Rust using objc2-core-ml
- Requires implementing text preprocessing, duration prediction, and synthesis
- Most control, but most work

### Option 2: Swift Bridge/Plugin
- Create a Tauri plugin that uses FluidInference's Swift FluidAudio library
- Leverage existing Swift implementation
- Requires Swift/Tauri plugin development

### Option 3: Hybrid Approach
- Use kokoros crate for text preprocessing and voice loading
- Use CoreML models only for the synthesizer inference
- Mix of both implementations

## Current Model Structure

The `kokoro-82m-coreml` directory contains:
- **Synthesizer Models**: `kokoro_21_5s`, `kokoro_21_10s`, `kokoro_21_15s`, `kokoro_24_10s`, `kokoro_24_15s`
- **Lexicon Files**: `us_lexicon_cache.json`, `gb_gold.json`, `gb_silver.json`, `us_gold.json`, `us_silver.json`
- **Vocabulary**: `vocab_index.json`
- **Voices**: JSON files in `voices/` directory (54 voices)

## Next Steps

1. **Implement CoreML Model Loading**:
   - Study objc2-core-ml documentation/examples
   - Implement proper NSURL and MLModel loading
   - Test with actual `.mlpackage` files

2. **Study FluidInference Implementation**:
   - Review FluidAudio Swift code for TTS pipeline
   - Understand text preprocessing approach
   - Understand model input/output formats

3. **Implement TTS Pipeline**:
   - Start with text preprocessing (may need external library)
   - Implement duration prediction
   - Implement synthesizer inference
   - Test end-to-end

4. **Testing**:
   - Test CoreML model loading
   - Test TTS generation with various texts
   - Benchmark performance vs ONNX Runtime
   - Verify ANE/GPU utilization

## References

- [FluidInference Kokoro CoreML Models](https://huggingface.co/FluidInference/kokoro-82m-coreml)
- [FluidAudio GitHub](https://github.com/FluidInference/FluidAudio)
- [objc2-core-ml crate](https://docs.rs/objc2-core-ml/)
- [kokoro-coreml repository](https://github.com/mattmireles/kokoro-coreml)

