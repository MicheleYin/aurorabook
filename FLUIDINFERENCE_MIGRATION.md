# Migration to FluidInference Models

This document describes the migration from custom CoreML implementation to using FluidInference's optimized Kokoro models via the `kokoros` crate.

## Changes Made

1. **Removed Custom CoreML Implementation**: The custom `kokoro_coreml.rs` module has been removed. It was causing issues with loading `.mlpackage` bundles.

2. **Using kokoros Crate Directly**: Now using the `kokoros` crate on all platforms, which handles CoreML via ONNX Runtime with CoreML Execution Provider on macOS/iOS.

3. **Simplified Code**: Removed platform-specific code paths. The `kokoros` crate automatically uses the best available backend (CoreML on Apple platforms, CUDA on others).

## Benefits

- **Better Model Support**: The `kokoros` crate properly handles CoreML models including `.mlpackage` bundles
- **Simpler Code**: No need for custom CoreML wrapper code
- **Better Performance**: ONNX Runtime with CoreML EP provides optimal ANE/GPU utilization
- **Easier Maintenance**: One code path instead of platform-specific implementations

## Using FluidInference Models

To use FluidInference's optimized models from Hugging Face:

1. Download models from: https://huggingface.co/FluidInference/kokoro-82m-coreml
2. Point `model_path` to the directory containing the models
3. The `kokoros` crate will automatically use them via ONNX Runtime

## References

- [FluidInference Kokoro CoreML Models](https://huggingface.co/FluidInference/kokoro-82m-coreml)
- [FluidAudio GitHub](https://github.com/FluidInference/FluidAudio)
- [kokoros crate](https://github.com/lucasjinreal/Kokoros)

