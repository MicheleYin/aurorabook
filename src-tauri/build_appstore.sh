#!/bin/bash

# Script to build, sign, package, and prepare AuroraBook for Mac App Store submission
# This script handles the complete command-line workflow without Xcode

set -e

echo "🚀 Building AuroraBook for Mac App Store"
echo "=========================================="

# Configuration
APP_NAME="AuroraBook"
BUNDLE_ID="com.micheleyin.aurorabook"
TEAM_ID="YOUR_TEAM_ID"
BUILD_DIR="src-tauri/target/release/bundle/macos"
# Get absolute path to entitlements (from project root)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTITLEMENTS="$PROJECT_ROOT/src-tauri/gen/apple/aurorabook_macOS/aurorabook_macOS.entitlements"

# Step 1: Build the app
echo ""
echo "📦 Step 1: Building the app..."
cd src-tauri
bun tauri build --target aarch64-apple-darwin
cd ..

# Check if app exists
APP_PATH="$BUILD_DIR/$APP_NAME.app"
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: App not found at $APP_PATH"
    exit 1
fi
echo "✅ App built successfully at $APP_PATH"

# Step 2: Find signing certificates
echo ""
echo "🔐 Step 2: Checking signing certificates..."

APP_CERT=$(security find-identity -v -p codesigning | grep "3rd Party Mac Developer Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
INSTALLER_CERT=$(security find-identity -v -p codesigning | grep "3rd Party Mac Developer Installer" | head -1 | sed 's/.*"\(.*\)".*/\1/')

if [ -z "$APP_CERT" ]; then
    echo "❌ Error: '3rd Party Mac Developer Application' certificate not found"
    echo "   Please create it at: https://developer.apple.com/account/resources/certificates/list"
    exit 1
fi

echo "✅ Found app certificate: $APP_CERT"

if [ -z "$INSTALLER_CERT" ]; then
    echo "⚠️  Warning: '3rd Party Mac Developer Installer' certificate not found"
    echo "   Package creation will be skipped (you can upload .app directly to App Store Connect)"
    CREATE_PKG=false
else
    echo "✅ Found installer certificate: $INSTALLER_CERT"
    CREATE_PKG=true
fi

# Step 3: Sign the app
echo ""
echo "✍️  Step 3: Signing the app..."

# Remove existing signature if any
codesign --remove-signature "$APP_PATH" 2>/dev/null || true

# Verify entitlements file exists
if [ ! -f "$ENTITLEMENTS" ]; then
    echo "❌ Error: Entitlements file not found at $ENTITLEMENTS"
    exit 1
fi

# Sign with entitlements
codesign --force --deep --sign "$APP_CERT" \
  --entitlements "$ENTITLEMENTS" \
  "$APP_PATH"

# Verify signature
if codesign --verify --verbose "$APP_PATH" 2>&1; then
    echo "✅ App signed successfully"
else
    echo "❌ Error: App signature verification failed"
    exit 1
fi

# Step 4: Create installer package (optional)
if [ "$CREATE_PKG" = true ]; then
    echo ""
    echo "📦 Step 4: Creating installer package (optional)..."
    
    cd "$BUILD_DIR"
    
    # Remove existing package if any
    rm -f "$APP_NAME.pkg"
    
    # Create package
    productbuild \
      --component "$APP_NAME.app" /Applications \
      --sign "$INSTALLER_CERT" \
      "$APP_NAME.pkg"
    
    # Verify package signature
    if pkgutil --check-signature "$APP_NAME.pkg" > /dev/null 2>&1; then
        echo "✅ Package created and signed successfully: $BUILD_DIR/$APP_NAME.pkg"
    else
        echo "❌ Error: Package signature verification failed"
        exit 1
    fi
    
    cd - > /dev/null
else
    echo ""
    echo "⏭️  Step 4: Skipping package creation (installer certificate not found)"
    echo "   You can upload the .app bundle directly to App Store Connect"
fi

echo ""
echo "✅ Build complete!"
echo ""
echo "📋 Next steps:"
echo ""
echo "   Upload to App Store Connect (you can upload the .app directly!):"
echo ""
echo "   Option 1: Upload via command line:"
echo "      cd $BUILD_DIR"
echo "      xcrun altool --upload-app \\"
if [ "$CREATE_PKG" = true ]; then
    echo "        --type macos \\"
    echo "        --file $APP_NAME.pkg \\"
else
    echo "        --type macos \\"
    echo "        --file $APP_NAME.app \\"
fi
echo "        --apiKey 'YOUR_API_KEY' \\"
echo "        --apiIssuer 'YOUR_ISSUER_ID'"
echo ""
echo "   Option 2: Upload via web interface:"
echo "      1. Go to https://appstoreconnect.apple.com"
echo "      2. Select your app → App Store tab → macOS App"
echo "      3. Click + Version or + Build"
if [ "$CREATE_PKG" = true ]; then
    echo "      4. Upload: $BUILD_DIR/$APP_NAME.pkg"
else
    echo "      4. Upload: $BUILD_DIR/$APP_NAME.app"
fi
echo ""
echo "   Note: Notarization is handled automatically during upload"

