# Voice preview MP3s (Supertonic)

Preview clips for **Settings → Default voice** (play button) are loaded from:

`voice-samples/{language}/{voiceId}.mp3`

where `language` is a Supertonic 3 TTS code (31 languages; see `AVAILABLE_LANGS`), and `voiceId` is `F1`–`F5` or `M1`–`M5`. If a language-specific clip is missing, the UI falls back to `en`.

The UI shows human-readable names (Sora, Luna, …) via translations; file names stay as engine ids.

## Generate (Supertonic TTS)

From `tts-tauri/src-tauri` (recommended):

```bash
cargo gen-voice-samples
```

From the **repository root**:

```bash
chmod +x tts-tauri/scripts/generate_supertonic_voice_samples.sh
./tts-tauri/scripts/generate_supertonic_voice_samples.sh
```

This runs `gen_voice_samples` in `tts-tauri/src-tauri`, using the same in-tree Supertonic + ONNX Runtime stack as the app.

Requires:

- Supertonic bundle: `resources/supertonic/onnx/` (with `tts.json`) and `resources/supertonic/voice_styles/` (usually present after syncing or building the app), **or** a full tree pointed to with env vars below
- `ffmpeg` on `PATH`
- Rust toolchain (first run compiles the binary)

Override paths if needed:

```bash
export SUPERONIC_ROOT=/path/to/supertonic-3   # sets ONNX + voices unless overridden
export OUT_DIR=/path/to/tts-tauri/src-tauri/resources/voice-samples
./tts-tauri/scripts/generate_supertonic_voice_samples.sh
```

Or set `SUPERTONIC_ONNX_DIR`, `SUPERTONIC_VOICES_ROOT`, and `VOICE_SAMPLES_OUT` directly. To run a pre-built binary: `export GEN_VOICE_SAMPLES_BIN=/path/to/gen_voice_samples` then run the script.

If a language-specific file is missing, the app falls back to `voice-samples/en/{voiceId}.mp3`.

See also `tts-tauri/scripts/README-voice-samples.md` for legacy notes.
