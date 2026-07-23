#!/usr/bin/env bash
# Fast-path Rust tests: lib unit tests + modular integration harness (`tests/mod`).
# Skips slow/model/FFmpeg/AppHandle binaries under tests/*.rs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/src-tauri"

export PATH="${HOME}/.cargo/bin:${PATH}"

mkdir -p resources/ort-dylibs
if [[ ! -f resources/ffmpeg ]]; then
  : > resources/ffmpeg
  chmod +x resources/ffmpeg
fi

if [[ $# -eq 0 ]]; then
  cargo test --lib --test mod
else
  cargo test "$@"
fi
