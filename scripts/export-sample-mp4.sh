#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_TAURI_DIR="$ROOT_DIR/src-tauri"
OUT_DIR="${1:-$ROOT_DIR/sample_audio}"

echo "Exporting sample EPUB to m4a/m4b..."
echo "Output directory: $OUT_DIR"

cd "$SRC_TAURI_DIR"
AURORABOOK_SAMPLE_EXPORT_OUT_DIR="$OUT_DIR" \
  cargo test --lib sample_epub_exports_m4a_and_m4b_are_parseable -- --nocapture

echo "Done."
echo "Generated:"
echo "  $OUT_DIR/Sample .epub Book.m4a"
echo "  $OUT_DIR/Sample .epub Book.m4b"
