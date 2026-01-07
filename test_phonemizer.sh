#!/bin/bash

# Test script for phonemizer using kokoros

set -e

echo "=== Testing Phonemizer with kokoros ==="
echo ""

# Set TAURI_RESOURCE_DIR if not already set
if [ -z "$TAURI_RESOURCE_DIR" ]; then
    # Try to find the resource directory
    if [ -d "src-tauri/resources" ]; then
        export TAURI_RESOURCE_DIR="$(cd src-tauri/resources && pwd)"
        echo "Set TAURI_RESOURCE_DIR to: $TAURI_RESOURCE_DIR"
    else
        echo "Warning: TAURI_RESOURCE_DIR not set and src-tauri/resources not found"
        echo "The test will try to find the model in common locations"
    fi
else
    echo "TAURI_RESOURCE_DIR already set to: $TAURI_RESOURCE_DIR"
fi

echo ""
echo "Running phonemizer test..."
echo ""

# Run the test example
cd Kokoros/kokoros
cargo run --example test_phonemizer

