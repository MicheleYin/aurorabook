# Voice preview MP3s (Supertonic)

Preview clips for **Settings → Default voice** (play button) are loaded from:

`voice-samples/{language}/{voiceId}.mp3`

where `language` is the current **TTS language** setting (Supertonic 3 code; 30 languages in `AVAILABLE_LANGS`), and `voiceId` is `F1`–`F5` or `M1`–`M5`. Changing TTS language switches which folder is read so each voice can be previewed in that language. If a language-specific clip is missing, the UI falls back to `en`.

The UI shows human-readable names (Sora, Luna, …) via translations; file names stay as engine ids.

## Generate (Supertonic TTS)

From `tts-tauri/src-tauri` (recommended):

```bash
cargo gen-voice-samples
```

From the **repository root** / `tts-tauri`:

```bash
chmod +x scripts/generate_supertonic_voice_samples.sh
./scripts/generate_supertonic_voice_samples.sh
```

This runs `gen_voice_samples`, writing **all** supported languages × 10 voices (300 MP3s) under this directory.

Requires:

- Supertonic bundle: `resources/supertonic/onnx/` (with `tts.json`) and `resources/supertonic/voice_styles/`
- `ffmpeg` on `PATH`
- Rust toolchain (first run compiles the binary)

Override paths if needed:

```bash
export SUPERONIC_ROOT=/path/to/supertonic-3
export OUT_DIR=/path/to/tts-tauri/src-tauri/resources/voice-samples
./scripts/generate_supertonic_voice_samples.sh
```

Or set `SUPERTONIC_ONNX_DIR`, `SUPERTONIC_VOICES_ROOT`, and `VOICE_SAMPLES_OUT` directly.

See also `scripts/README-voice-samples.md`.
