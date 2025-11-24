# CoreML Implementation Status

## ✅ Completed

1. **Infrastructure Setup**:
   - ✅ Added `objc2-core-ml` dependencies for CoreML bindings
   - ✅ Created `kokoro_coreml.rs` module structure
   - ✅ Platform-specific compilation (macOS/iOS vs others)
   - ✅ Integrated with existing Tauri command structure
   - ✅ Created compatible API interface matching kokoros

2. **Model Conversion Setup**:
   - ✅ Cloned kokoro-coreml repository
   - ✅ Reviewed export scripts and model structure
   - ✅ Created `COREML_SETUP.md` with conversion instructions

3. **Code Structure**:
   - ✅ `KokoroCoreML` struct for single instance
   - ✅ `KokoroCoreMLParallel` for parallel processing
   - ✅ `TTSInstance` trait for API compatibility
   - ✅ Platform-specific `generate_tts_cached` and `generate_tts_batch` implementations

## ⚠️ In Progress / TODO

### Critical: Model Loading Implementation

The CoreML model loading code is currently a placeholder. The `objc2-core-ml` API requires:

1. **Proper NSURL creation**: Need to use correct Objective-C API
2. **MLModel loading**: Need to understand `modelWithContentsOfURL_configuration_error` return type
3. **Thread safety**: MLModel may not be Send/Sync, needs careful handling

**Current blocker**: objc2-core-ml API documentation/examples needed to properly load models.

### TTS Pipeline Implementation

Once models are loaded, need to implement:

1. **Text Preprocessing**:
   - Phoneme conversion (grapheme-to-phoneme)
   - Tokenization to input_ids [1,128]
   - May need Python bridge or espeak-ng bindings

2. **Voice Loading**:
   - Load voice embeddings from `voices-v1.0.bin`
   - Extract `ref_s` [1,256] for selected voice

3. **Duration Prediction**:
   - Prepare inputs: `input_ids [1,128]`, `attention_mask [1,128]`, `ref_s [1,256]`, `speed [1]`
   - Run duration model inference
   - Extract `pred_dur`, `t_en`, `s`, `ref_s_out`

4. **Alignment Building**:
   - Build `pred_aln_trg [tokens, frames]` from `pred_dur`
   - Compute `asr = t_en @ pred_aln_trg` → `[1,512,72]` for 3s bucket
   - Derive F0/N curves

5. **Synthesizer Inference**:
   - Select appropriate bucket (3s, 5s, 10s, 30s) based on duration
   - Prepare inputs: `asr [1,512,72]`, `F0_pred [1,144]`, `N_pred [1,144]`, `ref_s [1,256]`
   - Run synthesizer model
   - Extract `waveform [1,43200]` for 3s (or appropriate length)

6. **Post-processing**:
   - Convert waveform to audio samples
   - Apply any necessary normalization

## Next Steps

1. **Study objc2-core-ml API**:
   - Check documentation/examples
   - Test model loading with a simple example
   - Understand thread safety requirements

2. **Implement Model Loading**:
   - Fix NSURL creation
   - Properly load MLModel instances
   - Store models in thread-safe way

3. **Implement TTS Pipeline**:
   - Start with text preprocessing (may need external library)
   - Implement duration prediction
   - Implement synthesizer inference
   - Test end-to-end

4. **Testing**:
   - Test with converted CoreML models
   - Verify ANE/GPU utilization
   - Benchmark performance vs ONNX Runtime

## References

- [kokoro-coreml repository](https://github.com/mattmireles/kokoro-coreml)
- [objc2-core-ml crate](https://docs.rs/objc2-core-ml/)
- [ONNX Runtime CoreML EP docs](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)

