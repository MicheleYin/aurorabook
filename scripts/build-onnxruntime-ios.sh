#!/bin/bash

# Script to build ONNX Runtime for iOS
# Based on: https://onnxruntime.ai/docs/build/ios.html

set -e

echo "🔨 Building ONNX Runtime for iOS"
echo "=================================="

# Configuration
IOS_DEPLOYMENT_TARGET="15.1"
BUILD_CONFIG="Release"
ONNXRUNTIME_DIR="${ONNXRUNTIME_DIR:-../onnxruntime}"
BUILD_DIR="${ONNXRUNTIME_DIR}/build/iOS"

# Use Python 3.11 if available (ONNX Runtime supports 3.8-3.12, Python 3.14 may have issues)
# build.sh calls python3 directly, so we need to ensure python3 points to 3.11
PYTHON3_PATH=""
if command -v python3.11 &> /dev/null; then
    PYTHON3_PATH=$(which python3.11)
    export Python_EXECUTABLE="$PYTHON3_PATH"
    export PYTHON_EXECUTABLE="$PYTHON3_PATH"
    # Prepend Python 3.11's directory to PATH so 'python3' resolves to 3.11
    export PATH="$(dirname "$PYTHON3_PATH"):$PATH"
    echo "✅ Using Python 3.11 for build compatibility"
    echo "   Python path: $PYTHON3_PATH"
elif command -v python3.12 &> /dev/null; then
    PYTHON3_PATH=$(which python3.12)
    export Python_EXECUTABLE="$PYTHON3_PATH"
    export PYTHON_EXECUTABLE="$PYTHON3_PATH"
    export PATH="$(dirname "$PYTHON3_PATH"):$PATH"
    echo "✅ Using Python 3.12 for build compatibility"
    echo "   Python path: $PYTHON3_PATH"
else
    echo "⚠️  Using default Python (may be too new - ONNX Runtime supports Python 3.8-3.12)"
    echo "   Consider installing Python 3.11 or 3.12: brew install python@3.11"
fi

# Check prerequisites
echo ""
echo "📋 Checking prerequisites..."

if ! command -v cmake &> /dev/null; then
    echo "❌ Error: CMake is not installed"
    echo "   Install with: brew install cmake"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    exit 1
fi

if [ ! -d "/Applications/Xcode.app" ]; then
    echo "❌ Error: Xcode is not installed"
    exit 1
fi

echo "✅ Prerequisites check passed"

# Check if ONNX Runtime directory exists
if [ ! -d "$ONNXRUNTIME_DIR" ]; then
    echo ""
    echo "📦 ONNX Runtime directory not found at: $ONNXRUNTIME_DIR"
    echo "   Cloning ONNX Runtime repository..."
    
    # Get the absolute path to the project root
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    ONNXRUNTIME_DIR="$PROJECT_ROOT/onnxruntime"
    
    if [ ! -d "$ONNXRUNTIME_DIR" ]; then
        echo "   Cloning from GitHub..."
        git clone --recursive https://github.com/microsoft/onnxruntime.git "$ONNXRUNTIME_DIR"
    fi
fi

cd "$ONNXRUNTIME_DIR"

# Check if build.sh exists
if [ ! -f "./build.sh" ]; then
    echo "❌ Error: build.sh not found in ONNX Runtime directory"
    echo "   Make sure you're in the ONNX Runtime root directory"
    exit 1
fi

# Clean up build directory to avoid database lock issues
echo ""
echo "🧹 Cleaning build directory to avoid lock issues..."
if [ -d "$BUILD_DIR" ]; then
    # Remove Xcode build databases and lock files
    find "$BUILD_DIR" -name "build.db" -type f -delete 2>/dev/null || true
    find "$BUILD_DIR" -name "*.xcbuilddata" -type f -delete 2>/dev/null || true
    find "$BUILD_DIR" -name "XCBuildData" -type d -exec rm -rf {} + 2>/dev/null || true
    # Remove CMake cache to force fresh configuration
    find "$BUILD_DIR" -name "CMakeCache.txt" -type f -delete 2>/dev/null || true
    find "$BUILD_DIR" -name "CMakeFiles" -type d -exec rm -rf {} + 2>/dev/null || true
    echo "✅ Build directory cleaned"
fi

echo ""
echo "🏗️  Building ONNX Runtime for iOS device (arm64)"
echo "   Config: $BUILD_CONFIG"
echo "   iOS Deployment Target: $IOS_DEPLOYMENT_TARGET"
echo "   CoreML EP: Disabled (coremltools build issue - will use CPU EP)"
echo "   KleidiAI: Disabled (--no_kleidiai) to avoid missing kai_* symbols"
echo "   XNNPACK: Enabled (--use_xnnpack) for optimized performance"
echo "   Python: ${Python_EXECUTABLE:-$(which python3)}"
echo "   Note: This build will take 30-60 minutes"
echo ""

# Function to patch CMakeLists.txt files for dependencies with old CMake requirements
# This fixes CMake compatibility issues with newer CMake versions
patch_dependency_cmake() {
    local build_dir="$ONNXRUNTIME_DIR/build/iOS/$BUILD_CONFIG"
    local deps_dir="$build_dir/_deps"
    local patched_count=0
    
    if [ ! -d "$deps_dir" ]; then
        return 1
    fi
    
    echo "🔧 Patching dependency CMakeLists.txt files for CMake compatibility..."
    
    # List of dependencies that may have old CMake requirements
    local deps=("psimd" "fp16")
    
    # Determine sed command based on OS
    local sed_cmd
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed_cmd="sed -i ''"
    else
        sed_cmd="sed -i"
    fi
    
    # Patch each dependency if it exists
    for dep in "${deps[@]}"; do
        local cmake_path="$deps_dir/${dep}-src/CMakeLists.txt"
        if [ -f "$cmake_path" ]; then
            # Update CMAKE_MINIMUM_REQUIRED to 3.5
            $sed_cmd 's/CMAKE_MINIMUM_REQUIRED(VERSION.*)/CMAKE_MINIMUM_REQUIRED(VERSION 3.5)/' "$cmake_path" 2>/dev/null
            if [ $? -eq 0 ]; then
                echo "   ✅ Patched ${dep} CMakeLists.txt"
                patched_count=$((patched_count + 1))
            fi
        fi
    done
    
    # Also search for any other CMakeLists.txt files with old requirements
    while IFS= read -r cmake_file; do
        # Check if file has CMAKE_MINIMUM_REQUIRED with version < 3.5
        if grep -qE "CMAKE_MINIMUM_REQUIRED\(VERSION [0-2]\." "$cmake_file" 2>/dev/null || \
           grep -qE "CMAKE_MINIMUM_REQUIRED\(VERSION 3\.[0-4]\)" "$cmake_file" 2>/dev/null; then
            # Patch it
            $sed_cmd 's/CMAKE_MINIMUM_REQUIRED(VERSION.*)/CMAKE_MINIMUM_REQUIRED(VERSION 3.5)/' "$cmake_file" 2>/dev/null
            if [ $? -eq 0 ]; then
                local dep_name=$(basename "$(dirname "$cmake_file")" | sed 's/-src$//')
                echo "   ✅ Patched ${dep_name} CMakeLists.txt"
                patched_count=$((patched_count + 1))
            fi
        fi
    done < <(find "$deps_dir" -name "CMakeLists.txt" -type f 2>/dev/null)
    
    if [ $patched_count -gt 0 ]; then
        echo "   ✅ Patched $patched_count dependency CMakeLists.txt file(s)"
        return 0
    fi
    
    return 1
}

# Build for iOS device with CoreML support
# Note: Using --apple_sysroot (not --ios_sysroot) as per ONNX Runtime docs
BUILD_ATTEMPTS=0
MAX_ATTEMPTS=2

while [ $BUILD_ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    BUILD_ATTEMPTS=$((BUILD_ATTEMPTS + 1))
    
    if [ $BUILD_ATTEMPTS -eq 1 ]; then
        echo "   Attempting build..."
    else
        echo "   Retrying build after patching dependencies..."
    fi
    
    # Try the build
    # Note: --use_coreml is disabled temporarily due to coremltools build issues
    # You can enable it later once coremltools CMake issues are resolved
    # --no_kleidiai: Disable KleidiAI to avoid missing kai_* symbol errors
    # --use_xnnpack: Use XNNPACK for optimized performance (recommended for iOS)
    # --skip_tests: Skip tests to speed up build
    # Note: The build script may force BUILD_SHARED_LIB=ON for iOS, but we need static libs
    # We'll override it and disable installation to avoid CMake export errors
    # IMPORTANT: Pass cmake_extra_defines as separate arguments, not semicolon-separated
    if ./build.sh \
        --config "$BUILD_CONFIG" \
        --use_xcode \
        --ios \
        --apple_sysroot iphoneos \
        --osx_arch arm64 \
        --apple_deploy_target "$IOS_DEPLOYMENT_TARGET" \
        --no_kleidiai \
        --use_xnnpack \
        --skip_tests \
        --cmake_extra_defines \
        "onnxruntime_BUILD_SHARED_LIB=OFF" \
        "CMAKE_SKIP_INSTALL_RULES=ON" \
        --parallel; then
        echo ""
        echo "✅ Build succeeded!"
        break
    else
        BUILD_EXIT_CODE=$?
        echo ""
        echo "⚠️  Build attempt $BUILD_ATTEMPTS failed (exit code: $BUILD_EXIT_CODE)"
        
        # If this is the first attempt, try to patch dependencies and retry
        if [ $BUILD_ATTEMPTS -eq 1 ]; then
            if patch_dependency_cmake; then
                echo "   Will retry build with patched dependencies..."
                continue
            fi
        fi
        
        # If we've exhausted attempts or patching didn't help, exit
        if [ $BUILD_ATTEMPTS -ge $MAX_ATTEMPTS ]; then
            echo "❌ Build failed after $MAX_ATTEMPTS attempts"
            exit $BUILD_EXIT_CODE
        fi
    fi
done

# Check build result
if [ $? -ne 0 ]; then
    echo ""
    echo "❌ ONNX Runtime build failed!"
    echo "   Check the error messages above"
    exit 1
fi

echo ""
echo "✅ ONNX Runtime build completed!"
echo ""
echo "📦 Build output location:"
echo "   $BUILD_DIR/$BUILD_CONFIG/Release-iphoneos/"
echo ""
echo "📋 Libraries should be available at:"
echo "   $BUILD_DIR/$BUILD_CONFIG/Release-iphoneos/libonnxruntime_*.a"
echo ""

# Verify libraries exist
LIB_DIR="$BUILD_DIR/$BUILD_CONFIG/Release-iphoneos"
if [ -d "$LIB_DIR" ] && [ -f "$LIB_DIR/libonnxruntime_common.a" ]; then
    echo "✅ Verified: ONNX Runtime libraries found"
    ls -lh "$LIB_DIR"/libonnxruntime_*.a | head -5
    echo ""
    echo "🎉 Ready to build iOS app!"
else
    echo "⚠️  Warning: Expected libraries not found in $LIB_DIR"
    echo "   The build may have completed but libraries are in a different location"
    echo "   Please check the build output above"
fi

