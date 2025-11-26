# Generating Voice Samples

Voice samples are generated using a Cargo test. This ensures samples are created consistently and can be run as part of the build process.

## How to Generate Voice Samples

Run the Cargo test from the `src-tauri` directory:

```bash
cd src-tauri
cargo test generate_voice_samples -- --nocapture --ignored
```

The test will:
1. Find the ONNX model and voices file
2. Generate TTS audio for all 28 voices
3. Convert to MP3 format (64 kbps for smaller file size)
4. Save files to `src-tauri/resources/voice-samples/`

## Generated Files

After running the test, you'll have MP3 files in `src-tauri/resources/voice-samples/`:
- `af_heart.mp3`
- `af_alloy.mp3`
- `af_aoede.mp3`
- ... (one for each voice, 28 total)

These files are automatically bundled with the app via `tauri.conf.json` and accessible through the `read_resource_file` Tauri command.

## Sample Text

The default sample text is: "Hello, this is a sample of my voice. I hope you enjoy listening to it."

You can modify this in the test function in `src-tauri/src/lib.rs` if needed.

## Notes

- The test is marked with `#[ignore]` so it won't run during normal test execution
- Use `--ignored` flag to run ignored tests
- Files are generated as MP3 (64 kbps) to save space compared to WAV
