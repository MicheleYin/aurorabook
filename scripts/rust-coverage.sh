#!/usr/bin/env bash
# Fast-path Rust coverage: lib unit tests + modular integration harness (`tests/mod`).
# Skips slow/model/FFmpeg/AppHandle binaries under tests/*.rs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/src-tauri"

# cargo-llvm-cov is usually installed to ~/.cargo/bin; bun scripts may not inherit that PATH.
export PATH="${HOME}/.cargo/bin:${PATH}"

# tauri.macos.conf.json lists bundle resources that must exist for `tauri_build`
# even when we are only compiling tests (paths are gitignored).
mkdir -p resources/ort-dylibs
if [[ ! -f resources/ffmpeg ]]; then
  # Placeholder so Tauri resource validation passes; runtime tests use PATH ffmpeg.
  : > resources/ffmpeg
  chmod +x resources/ffmpeg
fi

if ! command -v cargo-llvm-cov >/dev/null 2>&1; then
  echo "cargo-llvm-cov not found. Install with:"
  echo "  cargo install cargo-llvm-cov --locked"
  echo "  rustup component add llvm-tools-preview"
  exit 1
fi

if ! rustup component list --installed 2>/dev/null | grep -q '^llvm-tools'; then
  echo "llvm-tools-preview not installed. Run:"
  echo "  rustup component add llvm-tools-preview"
  exit 1
fi

# Stable LCOV path under src-tauri/ (independent of .cargo/config.toml target-dir).
OUT_DIR="$ROOT/src-tauri/target/llvm-cov"
mkdir -p "$OUT_DIR"

# --lib: #[cfg(test)] in src/
# --test mod: modular suite (book_service, epub, utils, tts, …)
cargo llvm-cov --lcov --output-path "$OUT_DIR/lcov.info" --lib --test mod "$@"

echo "LCOV written to src-tauri/target/llvm-cov/lcov.info"
echo "HTML report: cd src-tauri && cargo llvm-cov --html --open --lib --test mod"
