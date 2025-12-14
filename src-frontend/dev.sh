#!/bin/bash
# Development script that runs Tailwind CSS watcher and Trunk serve

set -e

# Start Tailwind CSS watcher in background
echo "🎨 Starting Tailwind CSS watcher..."
bun run dev:css &
TAILWIND_PID=$!

# Function to cleanup on exit
cleanup() {
    echo "🛑 Stopping processes..."
    kill $TAILWIND_PID 2>/dev/null || true
    exit
}

trap cleanup SIGINT SIGTERM

# Wait a moment for CSS to build
sleep 1

# Start Trunk serve
echo "🚀 Starting Trunk dev server..."
trunk serve

# Cleanup when Trunk exits
cleanup
