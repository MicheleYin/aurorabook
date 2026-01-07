#!/bin/bash

# Script to run tauri dev with sandbox enabled
# This signs the app with entitlements after Tauri builds it

set -e

# Configuration
APP_NAME="AuroraBook"
BUILD_DIR="target/debug/bundle/macos"
ENTITLEMENTS="gen/apple/aurorabook_macOS/aurorabook_macOS.entitlements"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="$SCRIPT_DIR/$BUILD_DIR/$APP_NAME.app"

# Function to sign app with entitlements (ad-hoc signing for dev)
sign_app() {
    if [ ! -d "$APP_PATH" ]; then
        return 1
    fi

    echo "🔒 Signing app with entitlements for sandbox..."
    
    # Remove existing signatures
    codesign --remove-signature "$APP_PATH" 2>/dev/null || true
    codesign --remove-signature "$APP_PATH/Contents/MacOS/aurorabook" 2>/dev/null || true

    # Sign the main executable with entitlements (ad-hoc signing with -)
    codesign --force --sign "-" \
      --entitlements "$SCRIPT_DIR/$ENTITLEMENTS" \
      "$APP_PATH/Contents/MacOS/aurorabook" 2>/dev/null || true

    # Sign all nested frameworks and libraries
    find "$APP_PATH" -name "*.dylib" -o -name "*.framework" | while read lib; do
      codesign --force --sign "-" "$lib" 2>/dev/null || true
    done

    # Sign the app bundle
    codesign --force --deep --sign "-" \
      --entitlements "$SCRIPT_DIR/$ENTITLEMENTS" \
      "$APP_PATH" 2>/dev/null || true

    # Verify entitlements
    EXEC_ENTITLEMENTS=$(codesign -d --entitlements - "$APP_PATH/Contents/MacOS/aurorabook" 2>&1 || true)
    if echo "$EXEC_ENTITLEMENTS" | grep -q "com.apple.security.app-sandbox"; then
        echo "✅ App Sandbox enabled!"
    else
        echo "⚠️  Warning: Could not verify sandbox entitlement"
    fi
}

# Function to watch for app build and sign it
watch_and_sign() {
    echo "👀 Watching for app build..."
    while true; do
        if [ -d "$APP_PATH" ]; then
            # Wait a moment for Tauri to finish building
            sleep 2
            sign_app
            # Only sign once per build (check modification time)
            LAST_MODIFIED=$(stat -f "%m" "$APP_PATH" 2>/dev/null || echo "0")
            while true; do
                sleep 1
                CURRENT_MODIFIED=$(stat -f "%m" "$APP_PATH" 2>/dev/null || echo "0")
                if [ "$CURRENT_MODIFIED" != "$LAST_MODIFIED" ]; then
                    echo "🔄 App rebuilt, re-signing..."
                    sign_app
                    LAST_MODIFIED="$CURRENT_MODIFIED"
                fi
            done
        fi
        sleep 1
    done
}

# Start watching in background
watch_and_sign &
WATCH_PID=$!

# Cleanup on exit
cleanup() {
    echo "🛑 Stopping..."
    kill $WATCH_PID 2>/dev/null || true
    exit
}
trap cleanup EXIT INT TERM

# Run tauri dev
echo "🚀 Starting Tauri dev with sandbox..."
echo "   The app will be signed with entitlements after each build"
echo ""

cd "$SCRIPT_DIR"
bunx tauri dev

