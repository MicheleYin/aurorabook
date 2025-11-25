#!/bin/bash

# Script to sign the macOS app after building
# This fixes the "app is damaged" issue for other users

set -e

# Get the signing identity
SIGNING_IDENTITY="Apple Development: Michele Yin (YOUR_OLD_TEAM_ID)"

# Check if signing identity exists
if ! security find-identity -v -p codesigning | grep -q "$SIGNING_IDENTITY"; then
    echo "Warning: Signing identity '$SIGNING_IDENTITY' not found in keychain"
    echo "Available identities:"
    security find-identity -v -p codesigning
    exit 1
fi

# Find the built app - prefer release over debug
APP_PATH=$(find src-tauri/target -name "*.app" -type d -path "*/release/*" | head -1)

if [ -z "$APP_PATH" ]; then
    # Fallback to debug build
    APP_PATH=$(find src-tauri/target -name "*.app" -type d -path "*/debug/*" | head -1)
fi

if [ -z "$APP_PATH" ]; then
    echo "Error: Could not find built app in src-tauri/target"
    echo "Please build the app first with: bun run build:macos:unsigned"
    exit 1
fi

echo "Found app at: $APP_PATH"

# Remove any existing signature first
echo "Removing existing signature (if any)..."
codesign --remove-signature "$APP_PATH" 2>/dev/null || true

# Check for entitlements file
ENTITLEMENTS_FILE="src-tauri/gen/apple/tts-tauri_macOS/tts-tauri_macOS.entitlements"
if [ -f "$ENTITLEMENTS_FILE" ]; then
    echo "Signing app with entitlements..."
    codesign --force --deep --sign "$SIGNING_IDENTITY" --entitlements "$ENTITLEMENTS_FILE" "$APP_PATH"
else
    echo "Signing app (no entitlements file found)..."
    codesign --force --deep --sign "$SIGNING_IDENTITY" "$APP_PATH"
fi

# Verify the signature
echo "Verifying signature..."
if codesign --verify --verbose "$APP_PATH" 2>&1; then
    echo "✓ App signed successfully!"
    echo "App location: $APP_PATH"
    
    # Display signature info
    echo ""
    echo "Signature details:"
    codesign -dvv "$APP_PATH" 2>&1 | head -10
else
    echo "✗ Signature verification failed!"
    exit 1
fi

