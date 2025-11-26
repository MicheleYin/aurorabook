#!/bin/bash

# Script to install AuroraBook IPA on connected iOS device

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IPA_PATH="${SCRIPT_DIR}/src-tauri/gen/apple/build/arm64/AuroraBook.ipa"

if [ ! -f "${IPA_PATH}" ]; then
    echo "❌ Error: IPA file not found at ${IPA_PATH}"
    echo "   Please build the app first with: bun run build:ios"
    exit 1
fi

echo "📱 Checking for connected devices..."
DEVICES=$(xcrun devicectl list devices 2>/dev/null | grep "connected" | head -1)

if [ -z "${DEVICES}" ]; then
    echo "❌ Error: No connected iOS device found"
    echo "   Please connect your iPhone via USB and ensure it's unlocked"
    exit 1
fi

echo "✅ Found connected device"
echo ""
echo "Installing AuroraBook IPA..."
echo ""

# Try to install - will show helpful error if Developer Mode is disabled
if xcrun devicectl device install app "${IPA_PATH}" 2>&1; then
    echo ""
    echo "✅ Installation successful!"
    echo ""
    echo "📱 Next steps on your iPhone:"
    echo "   1. Go to Settings → General → VPN & Device Management"
    echo "   2. Tap on your developer certificate"
    echo "   3. Tap 'Trust [Your Name]'"
    echo "   4. Tap 'Trust' to confirm"
    echo "   5. The app should now appear on your home screen!"
else
    echo ""
    echo "❌ Installation failed"
    echo ""
    echo "Common issues:"
    echo "  • Developer Mode not enabled: Settings → Privacy & Security → Developer Mode"
    echo "  • Device not trusted: Unlock device and tap 'Trust This Computer'"
    echo "  • Device locked: Unlock your iPhone"
    exit 1
fi

