# CoreML Testing Guide

## Running the Tests

To test CoreML inference with a known string, run:

```bash
cd src-tauri
cargo test --test kokoro_coreml test_coreml_duration_model_inference -- --nocapture
```

Or test the full synthesis pipeline:

```bash
cargo test --test kokoro_coreml test_coreml_full_synthesis -- --nocapture
```

## Test Requirements

The tests require:
1. **Model files** in a `resources/` directory:
   - `kokoro_duration.mlpackage` (or `duration.mlpackage`)
   - At least one synthesizer model (e.g., `kokoro_synthesizer_3s.mlpackage`)
   - `voices-v1.0.bin`

2. **Resources directory** can be found in one of these locations:
   - `resources/` (from project root)
   - `../resources/` (from src-tauri)
   - `src-tauri/resources/`
   - Or set `KOKORO_MODEL_DIR` environment variable to point to the directory

## What the Tests Do

### `test_coreml_duration_model_inference`
- Initializes the CoreML engine
- Tests text preprocessing (currently using ASCII codes - this is the issue!)
- Loads voice embeddings
- Runs duration model inference
- Verifies outputs are produced
- Checks if durations are non-zero

### `test_coreml_full_synthesis`
- Tests the complete synthesis pipeline
- Generates audio from text
- Reports audio length, duration, and quality metrics
- Shows warnings if audio is empty or silent

## Expected Output

The tests will show:
- ✅ Success indicators for each step
- 📊 Debug information (input IDs, durations, audio samples)
- ⚠️ Warnings if something is wrong but not fatal
- ❌ Errors if something fails completely

## Known Issues

The current implementation uses **ASCII character codes** instead of **phoneme token IDs**. This means:
- The duration model may predict zero durations
- Audio output may be empty
- The models run successfully, but produce incorrect results

**This is why your WAV files are empty!** The models need proper phoneme tokenization to work correctly.

