#!/bin/bash
# Spike: build ONNX Runtime for iOS with native WebGPU EP (Dawn → Metal).
# Uses a separate build dir so the existing CoreML iOS libs are left alone.
#
# Known requirements (https://github.com/microsoft/onnxruntime/issues/32147):
#   - Dawn ObjCUtils.mm ARC patch in cmake/external/onnxruntime_external_deps.cmake
#   - --apple_deploy_target >= 16.3 (std::to_chars float overload)
#
# Output: $ONNXRUNTIME_DIR/build/iOS-webgpu/Release/Release-iphoneos/

set -euo pipefail

echo "🔨 Spike: ONNX Runtime iOS + WebGPU EP"
echo "======================================"

IOS_DEPLOYMENT_TARGET="${IOS_DEPLOYMENT_TARGET:-16.3}"
BUILD_CONFIG="${BUILD_CONFIG:-Release}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ONNXRUNTIME_DIR="${ONNXRUNTIME_DIR:-$PROJECT_ROOT/../onnxruntime}"
BUILD_DIR="${ONNXRUNTIME_DIR}/build/iOS-webgpu"

export CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}"

if command -v python3.11 >/dev/null 2>&1; then
  export PATH="$(dirname "$(command -v python3.11)"):$PATH"
  export Python_EXECUTABLE="$(command -v python3.11)"
elif command -v python3.12 >/dev/null 2>&1; then
  export PATH="$(dirname "$(command -v python3.12)"):$PATH"
  export Python_EXECUTABLE="$(command -v python3.12)"
fi

if [ ! -d "$ONNXRUNTIME_DIR" ] || [ ! -f "$ONNXRUNTIME_DIR/build.sh" ]; then
  echo "❌ ONNX Runtime not found at $ONNXRUNTIME_DIR"
  exit 1
fi

# Require the ARC workaround (applied in the sibling onnxruntime checkout for this spike).
if ! grep -q 'ObjCUtils.mm' "$ONNXRUNTIME_DIR/cmake/external/onnxruntime_external_deps.cmake"; then
  echo "❌ Missing Dawn ObjCUtils ARC patch in onnxruntime_external_deps.cmake"
  echo "   Apply the iOS -fno-objc-arc fix from microsoft/onnxruntime#32147 first."
  exit 1
fi

echo "   ORT dir:     $ONNXRUNTIME_DIR"
echo "   Build dir:   $BUILD_DIR"
echo "   Deploy tgt:  $IOS_DEPLOYMENT_TARGET (need >= 16.3 for WebGPU)"
echo "   WebGPU EP:   enabled (--use_webgpu)"
echo "   CoreML EP:   not requested (spike isolates WebGPU)"
echo ""

cd "$ONNXRUNTIME_DIR"

# Light clean of CMake/Xcode caches in the spike dir only
if [ -d "$BUILD_DIR" ]; then
  find "$BUILD_DIR" -name "build.db" -type f -delete 2>/dev/null || true
  find "$BUILD_DIR" -name "CMakeCache.txt" -type f -delete 2>/dev/null || true
  find "$BUILD_DIR" -name "CMakeFiles" -type d -exec rm -rf {} + 2>/dev/null || true
fi

./build.sh \
  --build_dir "$BUILD_DIR" \
  --config "$BUILD_CONFIG" \
  --use_xcode \
  --ios \
  --apple_sysroot iphoneos \
  --osx_arch arm64 \
  --apple_deploy_target "$IOS_DEPLOYMENT_TARGET" \
  --use_webgpu \
  --no_kleidiai \
  --skip_tests \
  --cmake_extra_defines \
  "onnxruntime_BUILD_SHARED_LIB=OFF" \
  "CMAKE_SKIP_INSTALL_RULES=ON" \
  --parallel

LIB_DIR="$BUILD_DIR/$BUILD_CONFIG/Release-iphoneos"
echo ""
echo "📦 Looking for WebGPU artifacts in: $LIB_DIR"
if [ -d "$LIB_DIR" ]; then
  ls -lh "$LIB_DIR"/libonnxruntime_providers_webgpu* 2>/dev/null || echo "⚠️  libonnxruntime_providers_webgpu not found"
  ls -lh "$LIB_DIR"/libdawn* 2>/dev/null || ls -lh "$LIB_DIR"/*dawn* 2>/dev/null || echo "⚠️  Dawn libs not found at top level (may be under _deps)"
  ls -lh "$LIB_DIR"/libonnxruntime_common.a 2>/dev/null || true
  echo ""
  echo "✅ Spike build finished. Next: register ep::WebGPU in core.rs + link WebGPU/Dawn from build.rs"
else
  echo "❌ Expected output dir missing: $LIB_DIR"
  exit 1
fi
