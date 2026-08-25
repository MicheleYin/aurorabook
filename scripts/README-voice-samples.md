# Voice sample assets

## Supertonic (current)

Previews are **per TTS language** and **per voice id** (F1…M5):

- Layout: `src-tauri/resources/voice-samples/{lang}/{F1..F5,M1..M5}.mp3` for every code in `AVAILABLE_LANGS` (30 languages; missing langs fall back to `en` in the UI)
- Generation: run **`scripts/generate_supertonic_voice_samples.sh`** from `tts-tauri/` or `cargo gen-voice-samples` from `src-tauri` (same ONNX stack as the app; needs `ffmpeg` and Supertonic assets under `resources/supertonic/` or `SUPERTONIC_ROOT`).

Details: `src-tauri/resources/voice-samples/README.md`.

## Legacy (Kokoro / ignored test)

Older docs referred to a Cargo test generating a flat list of Kokoro voice MP3s. That flow is **obsolete** for Supertonic; use the shell script above instead.
