#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/src-tauri/target"

if [[ ! -d "$TARGET_DIR" ]]; then
  exit 0
fi

echo "Cleaning stale espeak iOS CMake caches..."

# Remove iOS espeak-rs-sys CMake out dirs so cmake-rs always re-configures.
# This avoids 'gmake: Makefile: No such file or directory' after interrupted or moved builds.
find "$TARGET_DIR" \
  -type d \
  \( -path "*/aarch64-apple-ios/*/build/espeak-rs-sys-*/out" -o -path "*/aarch64-apple-ios-sim/*/build/espeak-rs-sys-*/out" \) \
  -print \
  -exec rm -rf {} +

echo "espeak iOS cache cleanup complete."
