#!/bin/bash

# Quick script to sign the dev app with sandbox entitlements
# Run this after tauri dev builds the app, or use it manually

set -e

# Configuration
APP_NAME="AuroraBook"
BUILD_DIR="target/debug/bundle/macos"
ENTITLEMENTS="gen/apple/aurorabook_macOS/aurorabook_macOS.entitlements"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="$SCRIPT_DIR/$BUILD_DIR/$APP_NAME.app"

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: App not found at $APP_PATH"
    echo "   Please run 'tauri dev' first and wait for the app to build"
    exit 1
fi

# Check if entitlements exist
if [ ! -f "$SCRIPT_DIR/$ENTITLEMENTS" ]; then
    echo "❌ Error: Entitlements file not found at $SCRIPT_DIR/$ENTITLEMENTS"
    exit 1
fi

echo "🔒 Signing dev app with sandbox entitlements..."
echo "   App: $APP_PATH"
echo "   Entitlements: $SCRIPT_DIR/$ENTITLEMENTS"
echo ""

# Remove existing signatures
codesign --remove-signature "$APP_PATH" 2>/dev/null || true
codesign --remove-signature "$APP_PATH/Contents/MacOS/aurorabook" 2>/dev/null || true

# Sign the main executable with entitlements (ad-hoc signing with -)
echo "📝 Signing main executable..."
codesign --force --sign "-" \
  --entitlements "$SCRIPT_DIR/$ENTITLEMENTS" \
  "$APP_PATH/Contents/MacOS/aurorabook"

# Sign all nested frameworks and libraries
echo "📝 Signing nested code..."
find "$APP_PATH" -name "*.dylib" -o -name "*.framework" | while read lib; do
  codesign --force --sign "-" "$lib" 2>/dev/null || true
done

# Sign the app bundle
echo "📝 Signing app bundle..."
codesign --force --deep --sign "-" \
  --entitlements "$SCRIPT_DIR/$ENTITLEMENTS" \
  "$APP_PATH"

# Verify
echo ""
echo "🔍 Verifying signature and entitlements..."
if codesign --verify --verbose "$APP_PATH" 2>&1; then
    echo "✅ App signed successfully!"
    echo ""
    EXEC_ENTITLEMENTS=$(codesign -d --entitlements - "$APP_PATH/Contents/MacOS/aurorabook" 2>&1)
    if echo "$EXEC_ENTITLEMENTS" | grep -q "com.apple.security.app-sandbox"; then
        echo "✅ App Sandbox entitlement verified!"
        echo ""
        echo "🎉 Your app is now running with sandbox enabled!"
    else
        echo "⚠️  Warning: App Sandbox entitlement not found in executable"
    fi
else
    echo "❌ Error: Signature verification failed"
    exit 1
fi

