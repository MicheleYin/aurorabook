#!/bin/bash
# Build script for Leptos frontend with Tailwind CSS

set -e

echo "🎨 Building Tailwind CSS..."
bun run build:css

echo "✅ Tailwind CSS built successfully"
