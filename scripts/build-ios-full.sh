#!/bin/bash

# Complete iOS build script - builds ONNX Runtime and iOS app
set -e

echo "🚀 Complete iOS Build Process"
echo "=============================="
echo ""

# Step 1: Build ONNX Runtime for iOS
echo "📋 Step 1/3: Building ONNX Runtime for iOS..."
echo "   This may take 30-60 minutes..."
echo ""

if ./scripts/build-onnxruntime-ios.sh; then
    echo ""
    echo "✅ ONNX Runtime build completed successfully!"
else
    echo ""
    echo "❌ ONNX Runtime build failed!"
    echo "   Check the error messages above"
    exit 1
fi

# Step 2: Verify ONNX Runtime libraries exist
echo ""
echo "📋 Step 2/3: Verifying ONNX Runtime libraries..."
LIB_DIR="onnxruntime/build/iOS/Release/Release-iphoneos"

if [ -d "$LIB_DIR" ] && [ -f "$LIB_DIR/libonnxruntime_common.a" ]; then
    echo "✅ ONNX Runtime libraries found:"
    ls -lh "$LIB_DIR"/libonnxruntime_*.a | head -5
    echo ""
else
    echo "❌ ONNX Runtime libraries not found in $LIB_DIR"
    echo "   Expected location: $LIB_DIR/libonnxruntime_*.a"
    exit 1
fi

# Step 3: Build iOS app
echo ""
echo "📋 Step 3/3: Building iOS app..."
echo ""

if bun run build:ios; then
    echo ""
    echo "🎉 iOS build completed successfully!"
    echo ""
    echo "📦 Output location:"
    echo "   src-tauri/gen/apple/Build/Products/Release-iphoneos/"
else
    echo ""
    echo "❌ iOS app build failed!"
    echo "   Check the error messages above"
    exit 1
fi
