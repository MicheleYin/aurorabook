#!/usr/bin/env bash
# Fast-path Rust tests: lib unit tests + modular integration harness (`tests/mod`).
# Skips slow/model/FFmpeg/AppHandle binaries under tests/*.rs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/src-tauri"

export PATH="${HOME}/.cargo/bin:${PATH}"

mkdir -p resources/ort-dylibs resources/ffmpeg-bin \
  resources/supertonic/onnx resources/supertonic/voice_styles
if [[ ! -f resources/ffmpeg-bin/ffmpeg ]]; then
  : > resources/ffmpeg-bin/ffmpeg
  chmod +x resources/ffmpeg-bin/ffmpeg
fi
if [[ ! -f resources/ffmpeg-bin/ffmpeg.exe ]]; then
  printf 'placeholder\n' > resources/ffmpeg-bin/ffmpeg.exe
fi
if [[ ! -f resources/ort-dylibs/libwebgpu_dawn.dylib ]]; then
  printf 'placeholder\n' > resources/ort-dylibs/libwebgpu_dawn.dylib
fi
if [[ ! -f resources/ort-dylibs/webgpu_dawn.dll ]]; then
  printf 'placeholder\n' > resources/ort-dylibs/webgpu_dawn.dll
fi

if [[ $# -eq 0 ]]; then
  cargo test --lib --test mod
else
  cargo test "$@"
fi
