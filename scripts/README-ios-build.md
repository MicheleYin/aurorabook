# Building AuroraBook for iOS

This guide explains how to build AuroraBook for iOS, including setting up ONNX Runtime.

## Prerequisites

- Mac computer with latest macOS
- Xcode (latest version)
- CMake (`brew install cmake`)
- Python 3
- Rust toolchain with iOS target: `rustup target add aarch64-apple-ios`

## Step 1: Build ONNX Runtime for iOS

ONNX Runtime must be built from source for iOS since pre-built binaries are not available for this target.

### Quick Build

Run the provided script:

```bash
./scripts/build-onnxruntime-ios.sh
```

This script will:
- Check prerequisites (CMake, Python 3, Xcode)
- Clone ONNX Runtime repository if needed
- Build ONNX Runtime for iOS device (arm64) with CoreML support
- Output libraries to `onnxruntime/build/iOS/Release/Release-iphoneos/`

### Manual Build

If you prefer to build manually:

```bash
# Clone ONNX Runtime (if not already done)
git clone --recursive https://github.com/microsoft/onnxruntime.git
cd onnxruntime

# Build for iOS device with CoreML EP
./build.sh \
    --config Release \
    --use_xcode \
    --ios \
    --apple_sysroot iphoneos \
    --osx_arch arm64 \
    --apple_deploy_target 15.1 \
    --use_coreml \
    --parallel
```

**Note:** The build process can take 30-60 minutes depending on your machine.

## Step 2: Build AuroraBook iOS App

Once ONNX Runtime is built, build the iOS app:

```bash
# Build for iOS device
bun run build:ios

# Or build for iOS simulator
bun run build:ios:sim
```

## Build Configuration

The build system is configured to:
- Automatically detect ONNX Runtime libraries in `onnxruntime/build/iOS/Release/Release-iphoneos/`
- Link ONNX Runtime static libraries
- Enable CoreML Execution Provider for optimized performance on Apple devices
- Set iOS deployment target to 15.1

## Troubleshooting

### ONNX Runtime libraries not found

If you see warnings about missing ONNX Runtime libraries:

1. Verify the build completed successfully:
   ```bash
   ls -la onnxruntime/build/iOS/Release/Release-iphoneos/libonnxruntime_*.a
   ```

2. Check that the path is correct relative to your project root

3. Rebuild ONNX Runtime if libraries are missing

### Build fails with linking errors

- Ensure ONNX Runtime was built with `--use_coreml` flag
- Verify all required libraries exist in the build output directory
- Check that Xcode command line tools are installed: `xcode-select --install`

### Build takes too long

- The ONNX Runtime build is a one-time process (unless you clean the build)
- Subsequent iOS app builds will be much faster
- Consider using `--parallel` flag to speed up ONNX Runtime build

### CMake compatibility errors (psimd dependency)

If you see an error about `CMAKE_MINIMUM_REQUIRED` compatibility with psimd:

```
CMake Error: Compatibility with CMake < 3.5 has been removed from CMake
```

The build script automatically patches this issue. If the build fails on the first attempt, it will:
1. Automatically patch the psimd CMakeLists.txt file
2. Retry the build

If you still encounter issues, you can manually patch the file:
```bash
# Find the psimd CMakeLists.txt
find onnxruntime/build -name "psimd-src" -type d

# Patch it (replace the path with the actual location)
sed -i '' 's/CMAKE_MINIMUM_REQUIRED(VERSION.*)/CMAKE_MINIMUM_REQUIRED(VERSION 3.5)/' \
  onnxruntime/build/iOS/Release/_deps/psimd-src/CMakeLists.txt
```

## References

- [ONNX Runtime iOS Build Guide](https://onnxruntime.ai/docs/build/ios.html)
- [ONNX Runtime iOS Installation](https://onnxruntime.ai/docs/install/#install-on-ios)
- [CoreML Execution Provider](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)

