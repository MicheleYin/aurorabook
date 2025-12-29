#!/bin/bash

# Quick script to sign the app for Mac App Store with correct paths

set -e

# Configuration
APP_NAME="AuroraBook"
BUILD_DIR="src-tauri/target/release/bundle/macos"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTITLEMENTS="$PROJECT_ROOT/src-tauri/gen/apple/aurorabook_macOS/aurorabook_macOS.entitlements"
APP_PATH="$PROJECT_ROOT/$BUILD_DIR/$APP_NAME.app"

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: App not found at $APP_PATH"
    echo "   Please build the app first: cd src-tauri && bun tauri build"
    exit 1
fi

# Check if entitlements exist
if [ ! -f "$ENTITLEMENTS" ]; then
    echo "❌ Error: Entitlements file not found at $ENTITLEMENTS"
    exit 1
fi

# Find certificate
echo "🔍 Looking for signing certificate..."
# Prioritize Mac App Store certificate over iOS certificate
CERT=$(security find-identity -v -p codesigning | grep "3rd Party Mac Developer Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')

# Fallback to Apple Distribution if Mac App Store cert not found (for testing)
if [ -z "$CERT" ]; then
    echo "⚠️  Warning: Mac App Store certificate not found, trying Apple Distribution..."
    CERT=$(security find-identity -v -p codesigning | grep "Apple Distribution" | head -1 | sed 's/.*"\(.*\)".*/\1/')
fi

if [ -z "$CERT" ]; then
    echo "❌ Error: No suitable certificate found"
    echo "   Available certificates:"
    security find-identity -v -p codesigning
    echo ""
    echo "   For Mac App Store, you need: '3rd Party Mac Developer Application'"
    echo "   Get it at: https://developer.apple.com/account/resources/certificates/list"
    exit 1
fi

echo "✅ Found certificate: $CERT"
echo "📝 Signing app at: $APP_PATH"
echo "📄 Using entitlements: $ENTITLEMENTS"

# Remove existing signatures
codesign --remove-signature "$APP_PATH" 2>/dev/null || true
codesign --remove-signature "$APP_PATH/Contents/MacOS/aurorabook" 2>/dev/null || true

# Sign the main executable first with entitlements
echo "📝 Signing main executable..."
codesign --force --sign "$CERT" \
  --entitlements "$ENTITLEMENTS" \
  "$APP_PATH/Contents/MacOS/aurorabook"

# Sign all nested frameworks and libraries
echo "📝 Signing nested code..."
find "$APP_PATH" -name "*.dylib" -o -name "*.framework" | while read lib; do
  codesign --force --sign "$CERT" "$lib" 2>/dev/null || true
done

# Sign the app bundle (this will verify all nested code is signed)
echo "📝 Signing app bundle..."
codesign --force --deep --sign "$CERT" \
  --entitlements "$ENTITLEMENTS" \
  "$APP_PATH"

# Verify
if codesign --verify --verbose "$APP_PATH" 2>&1; then
    echo "✅ App signed successfully!"
    codesign -dvv "$APP_PATH" 2>&1 | grep -E "(Authority|Identifier)" | head -5
    echo ""
    echo "🔍 Verifying entitlements on main executable..."
    EXEC_ENTITLEMENTS=$(codesign -d --entitlements - "$APP_PATH/Contents/MacOS/aurorabook" 2>&1)
    if echo "$EXEC_ENTITLEMENTS" | grep -q "com.apple.security.app-sandbox"; then
        echo "✅ App Sandbox entitlement found!"
    else
        echo "⚠️  Warning: App Sandbox entitlement not found in executable"
        echo "   Entitlements found:"
        echo "$EXEC_ENTITLEMENTS" | head -10
    fi
else
    echo "❌ Error: Signature verification failed"
    exit 1
fi


