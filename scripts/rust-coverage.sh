#!/usr/bin/env bash
# Fast-path Rust coverage (lib unit tests).
# Skips the stale `tests/mod` harness and slow/model/FFmpeg/AppHandle binaries.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/src-tauri"

if ! command -v cargo-llvm-cov >/dev/null 2>&1; then
  echo "cargo-llvm-cov not found. Install with:"
  echo "  cargo install cargo-llvm-cov --locked"
  echo "  rustup component add llvm-tools-preview"
  exit 1
fi

mkdir -p target/llvm-cov

# build.rs ensures macOS `resources/ffmpeg` before tauri_build.
cargo llvm-cov --lcov --output-path target/llvm-cov/lcov.info --lib "$@"

echo "LCOV written to src-tauri/target/llvm-cov/lcov.info"
echo "HTML report: cargo llvm-cov --html --open --lib"
