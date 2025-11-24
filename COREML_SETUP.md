# CoreML Setup Guide

This guide explains how to set up CoreML models for optimal ANE/GPU acceleration on Apple devices.

## Overview

The app uses CoreML models directly (instead of ONNX Runtime) on macOS/iOS for better performance:
- **17x faster than real-time** on M2 Ultra
- **ANE acceleration**: ~0.25-0.31s for 23.7s utterance
- **Direct GPU/Neural Engine utilization**

## Model Conversion

### Prerequisites

1. Clone the kokoro-coreml repository:
```bash
git clone https://github.com/mattmireles/kokoro-coreml
cd kokoro-coreml
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
# Or use the conda environment.yml provided
```

3. Download the original Kokoro models (if not already done):
```bash
# The kokoro-coreml repo should have instructions for this
```

### Converting Models

1. Run the conversion script:
```bash
python export_coreml.py
```

This will generate:
- `duration.mlpackage` - Duration prediction model
- `synthesizer_3s.mlpackage` - 3 second bucket synthesizer
- `synthesizer_5s.mlpackage` - 5 second bucket synthesizer
- `synthesizer_10s.mlpackage` - 10 second bucket synthesizer
- `synthesizer_30s.mlpackage` - 30 second bucket synthesizer

2. Copy models to app resources:
```bash
# Copy all .mlpackage files to src-tauri/resources/
cp duration.mlpackage src-tauri/resources/
cp synthesizer_*.mlpackage src-tauri/resources/
```

3. Update `tauri.conf.json` to bundle the models:
```json
{
  "bundle": {
    "resources": [
      "src-tauri/resources/*.mlpackage"
    ]
  }
}
```

## Model Directory Structure

The app expects models in a directory structure like:
```
app_data_dir/
├── kokoro-coreml/
│   ├── duration.mlpackage
│   ├── synthesizer_3s.mlpackage
│   ├── synthesizer_5s.mlpackage
│   ├── synthesizer_10s.mlpackage
│   └── synthesizer_30s.mlpackage
└── voices-v1.0.bin
```

## Implementation Status

⚠️ **Current Status**: CoreML wrapper is created but TTS pipeline is not yet implemented.

The `kokoro_coreml.rs` module provides:
- ✅ CoreML model loading with ANE/GPU configuration
- ✅ Parallel instance support
- ❌ TTS pipeline (duration prediction, synthesis, vocoder) - **TODO**

## Next Steps

To complete the CoreML implementation:

1. **Study kokoro-coreml pipeline**:
   - Review `kokoro-coreml/demo/` for Python implementation
   - Understand text preprocessing (grapheme/phoneme conversion)
   - Understand voice tensor loading
   - Understand duration prediction
   - Understand synthesizer bucketing
   - Understand vocoder post-processing

2. **Implement Rust equivalents**:
   - Text preprocessing (may need espeak-ng bindings or phonemizer)
   - Voice tensor loading from `voices-v1.0.bin`
   - Duration model inference
   - Synthesizer model inference with bucketing
   - Audio post-processing

3. **Update `generate_tts_cached` and `generate_tts_batch`**:
   - Add platform-specific logic to use CoreML on Apple devices
   - Keep ONNX Runtime path for other platforms

## Performance Expectations

Based on kokoro-coreml benchmarks (M2 Ultra):
- **End-to-end latency**: ~1.35s for 23.7s utterance (RTF ≈ 0.057)
- **ANE inference**: 0.25-0.31s (dominant computation)
- **CPU preprocessing**: 0.15-0.17s
- **17x faster than real-time**

## References

- [kokoro-coreml repository](https://github.com/mattmireles/kokoro-coreml)
- [ONNX Runtime CoreML EP docs](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)
- [objc2-core-ml crate](https://docs.rs/objc2-core-ml/)

