#!/usr/bin/env bash
# Generate MP3 voice previews for Settings → Voice preview buttons.
# Uses the `gen_voice_samples` binary (same kokoros + ort stack as the Tauri app).
# The standalone `koko` CLI may use a different ort version and fail ONNX load
# ("Protobuf parsing failed"); do not use it for this workflow.
#
# Prerequisites:
#   - Supertonic assets: typically bundled under
#     tts-tauri/src-tauri/resources/supertonic/ (onnx/ + voice_styles/) after a
#     sync/build, OR set SUPERONIC_ROOT / SUPERTONIC_ONNX_DIR / SUPERTONIC_VOICES_ROOT
#   - ffmpeg (for WAV → MP3)
#   - Rust toolchain (this script runs `cargo run --release --bin gen_voice_samples`)
#
# Usage (from repo root):
#   ./tts-tauri/scripts/generate_supertonic_voice_samples.sh
#
# Output:
#   tts-tauri/src-tauri/resources/voice-samples/{en,ko,es,pt,fr}/{F1..F5,M1..M5}.mp3
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC_TAURI="$REPO_ROOT/tts-tauri/src-tauri"
OUT_DIR="${OUT_DIR:-$SRC_TAURI/resources/voice-samples}"
SUPERTONIC_ROOT="${SUPERTONIC_ROOT:-}"

if [[ -n "$SUPERTONIC_ROOT" ]]; then
  export SUPERTONIC_ONNX_DIR="${SUPERTONIC_ONNX_DIR:-$SUPERTONIC_ROOT/onnx}"
  export SUPERTONIC_VOICES_ROOT="${SUPERTONIC_VOICES_ROOT:-$SUPERTONIC_ROOT}"
fi
export VOICE_SAMPLES_OUT="${VOICE_SAMPLES_OUT:-$OUT_DIR}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg not found on PATH" >&2
  exit 1
fi

ONNX_CHECK="${SUPERTONIC_ONNX_DIR:-$SRC_TAURI/resources/supertonic/onnx}"
if [[ ! -f "$ONNX_CHECK/tts.json" ]]; then
  echo "error: Supertonic ONNX dir missing tts.json: $ONNX_CHECK" >&2
  echo "Sync assets (app build), set SUPERONIC_ROOT, or set SUPERTONIC_ONNX_DIR." >&2
  exit 1
fi

cd "$SRC_TAURI"
if [[ -n "${GEN_VOICE_SAMPLES_BIN:-}" ]]; then
  exec "$GEN_VOICE_SAMPLES_BIN"
fi
exec cargo run --release --bin gen_voice_samples
