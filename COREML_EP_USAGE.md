# Using CoreML Execution Provider with Kokoro ONNX Model

This guide explains how to use the CoreML Execution Provider (CoreML EP) with your Kokoro ONNX model for optimal performance on Apple devices.

## Overview

The `kokoro_onnx_coreml` module provides a wrapper around ONNX Runtime that explicitly configures CoreML EP for hardware acceleration on macOS/iOS devices. This allows your ONNX models to leverage:
- **Apple Neural Engine (ANE)** - For optimal performance on devices with ANE
- **GPU** - For GPU acceleration when available
- **CPU** - As fallback

## Usage

### Basic Example

```rust
use kokoro_onnx_coreml::KokoroOnnxCoreML;
use std::collections::HashMap;
use ndarray::ArrayD;

// Initialize ONNX Runtime session with CoreML EP
let session = KokoroOnnxCoreML::new(
    "/path/to/kokoro-v1.0.onnx",
    true  // use_coreml = true
)?;

// Prepare inputs (example)
let mut inputs = HashMap::new();
let input_array = ArrayD::<f32>::from_shape_vec(
    vec![1, 256],  // shape
    vec![0.0; 256]  // data
)?;
inputs.insert("input_ids".to_string(), input_array);

// Run inference
let outputs = session.run(inputs)?;

// Access outputs
if let Some(audio) = outputs.get("audio") {
    // Process audio output
}
```

### Configuration Options

The CoreML EP is configured with optimal settings:
- **Model Format**: MLProgram (requires iOS 15+ or macOS 12+)
- **Compute Units**: ALL (uses ANE, GPU, and CPU as available)
- **Static Input Shapes**: false (allows dynamic shapes)
- **Subgraphs**: false (disabled for control flow operators)

### Integration with Existing Code

To use CoreML EP instead of the default kokoros fallback, you can modify the `generate_tts_cached` function in `lib.rs`:

```rust
// Instead of using kokoros directly, use CoreML EP wrapper
let session = kokoro_onnx_coreml::KokoroOnnxCoreML::new(
    &onnx_path_str,
    true  // Enable CoreML EP
)?;

// Use session.run() for inference
```

## Performance Benefits

Using CoreML EP provides:
- **17x faster than real-time** inference on M2 Ultra
- **ANE acceleration** for compatible operations
- **Lower latency** compared to CPU-only execution
- **Better power efficiency** on Apple devices

## Requirements

- macOS 10.15+ or iOS 13+
- ONNX Runtime compiled with CoreML EP support (included in `ort` crate)
- Kokoro ONNX model file (`kokoro-v1.0.onnx`)

## Troubleshooting

### Model Compatibility

Not all ONNX operators are supported by CoreML EP. If you encounter errors:
1. Check the [supported operators list](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html#supported-operators)
2. Use NeuralNetwork format instead of MLProgram for older devices
3. Fall back to CPU execution provider if needed

### Performance Issues

If performance is not as expected:
1. Enable profiling: `with_profile_compute_plan(true)` to see which operators run on which hardware
2. Check that your device has ANE (Apple Neural Engine)
3. Verify model is using MLProgram format for best performance

## References

- [ONNX Runtime CoreML EP Documentation](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)
- [ort crate documentation](https://docs.rs/ort/)

