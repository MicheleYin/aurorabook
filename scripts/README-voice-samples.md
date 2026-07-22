# Voice sample assets

## Supertonic (current)

Previews are **per TTS language** and **per voice id** (F1…M5):

- Layout: `src-tauri/resources/voice-samples/{lang}/{F1..F5,M1..M5}.mp3` (Supertonic 3 TTS codes; missing langs fall back to `en`)
- Generation: run **`tts-tauri/scripts/generate_supertonic_voice_samples.sh`** from the repo root (uses **`gen_voice_samples`**, same ONNX stack as the app; needs `ffmpeg` and Supertonic assets under `resources/supertonic/` or `SUPERTONIC_ROOT`).

Details: `src-tauri/resources/voice-samples/README.md`.

## Legacy (Kokoro / ignored test)

Older docs referred to a Cargo test generating a flat list of Kokoro voice MP3s. That flow is **obsolete** for Supertonic; use the shell script above instead.
