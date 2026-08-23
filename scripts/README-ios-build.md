# Building AuroraBook for iOS

This guide explains how to build AuroraBook for iOS, including setting up ONNX Runtime with the **WebGPU** execution provider (Dawn → Metal).

## Prerequisites

- Mac computer with latest macOS
- Xcode (latest version)
- CMake (`brew install cmake`)
- Python 3
- Rust toolchain with iOS target: `rustup target add aarch64-apple-ios`
- iOS deployment target **16.3+** (required by ORT WebGPU / `std::to_chars`)

## Step 1: Build ONNX Runtime for iOS (WebGPU)

ONNX Runtime must be built from source for iOS. Use the WebGPU spike script (preferred):

```bash
export CMAKE_POLICY_VERSION_MINIMUM=3.5
./scripts/build-onnxruntime-ios-webgpu.sh
```

This script will:
- Check prerequisites
- Build ONNX Runtime for iOS device (arm64) with `--use_webgpu`
- Output libraries to `../onnxruntime/build/iOS-webgpu/Release/Release-iphoneos/`
- Produce `libonnxruntime_providers_webgpu.a` plus Dawn/Tint static libs under `_deps/`

Requires the Dawn `ObjCUtils.mm` ARC workaround in the sibling onnxruntime checkout
([onnxruntime#32147](https://github.com/microsoft/onnxruntime/issues/32147)).

**Note:** The build process can take 30-60 minutes depending on your machine.

### Legacy CoreML build

`./scripts/build-onnxruntime-ios.sh` still builds a CPU/XNNPACK (optional CoreML) tree under
`build/iOS/`. The app now expects the **WebGPU** tree by default.

## Step 2: Build AuroraBook iOS App

```bash
# Build for iOS device
bun run build:ios

# Or build for iOS simulator (do not point ORT_LIB_LOCATION at iphoneos WebGPU libs)
bun run build:ios:sim
```

## Build Configuration

The build system is configured to:
- Prefer ONNX Runtime libraries in `onnxruntime/build/iOS-webgpu/Release/Release-iphoneos/`
- Link WebGPU EP + Dawn/Tint static libraries (and Metal / QuartzCore / IOSurface)
- Register `ep::WebGPU` with CPU fallback in Supertonic TTS
- Set iOS deployment target to **16.3**

## Troubleshooting

### ONNX Runtime libraries not found

1. Verify the WebGPU build completed:

```bash
ls -la ../onnxruntime/build/iOS-webgpu/Release/Release-iphoneos/libonnxruntime_*.a
ls -la ../onnxruntime/build/iOS-webgpu/Release/Release-iphoneos/libonnxruntime_providers_webgpu.a
```

2. Set `ORT_LIB_LOCATION` explicitly (see `src-tauri/signing/LOCAL_IOS_BUILD.md`)

### Dawn ObjCUtils / ARC errors

Apply the `-fno-objc-arc` patch for `ObjCUtils.mm` in
`onnxruntime/cmake/external/onnxruntime_external_deps.cmake` (see #32147).

### WebGPU EP not working

- Ensure ONNX Runtime was built with `--use_webgpu`
- Confirm Metal frameworks are linked (see `src-tauri/build.rs` → `link_ios_webgpu_dawn_deps`)
- Check app logs for `WebGPU session failed ... falling back to CPU-only`

### Build takes too long

ONNX Runtime builds can take 30-60 minutes. Subsequent app builds are much faster.

## Additional Resources

- [LOCAL_IOS_BUILD.md](../src-tauri/signing/LOCAL_IOS_BUILD.md) — local env / App Store notes
- [ONNX Runtime iOS Build Guide](https://onnxruntime.ai/docs/build/ios.html)
- [WebGPU Execution Provider](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)
- [ort execution providers](https://ort.pyke.io/perf/execution-providers)
