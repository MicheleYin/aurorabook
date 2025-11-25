# iOS Build Guide

## Current Build Issues

Your app has **three native dependencies** that don't build easily for iOS:

### 1. ONNX Runtime (ort-sys) - No iOS Prebuilt Binaries
**Error**: `downloaded binaries not available for target aarch64-apple-ios`

### 2. Opus Audio Codec (audiopus_sys) - CMake Compatibility  
**Error**: `Compatibility with CMake < 3.5 has been removed from CMake`

### 3. eSpeak-ng (espeak-rs-sys) - Build Issues
**Error**: Build script failures during compilation

## Recommended Solutions

### Option 1: Build Reader-Only Version First (Fastest Path)

Create an iOS build **without TTS features** to get the app running first:

1. **Temporarily disable TTS dependencies** in `Cargo.toml`:
   ```toml
   # Comment out or make optional:
   # kokoros = { path = "../Kokoros/kokoros", package = "kokoros", default-features = true }
   ```

2. **Build basic reader app**:
   ```bash
   bun tauri ios build --target aarch64-apple-ios
   ```

3. **Add TTS back later** once you have a working iOS build

### Option 2: Use Xcode Directly (May Handle Dependencies Better)

1. **Open the Xcode project**:
   ```bash
   cd src-tauri/gen/apple
   open tts-tauri.xcodeproj
   ```

2. **In Xcode**:
   - Select your iOS device or simulator
   - Go to **Product > Build** (⌘B)
   - Xcode may handle some build issues better than CLI

3. **Configure signing**:
   - Select your project in navigator
   - Go to **Signing & Capabilities**
   - Select your development team
   - Xcode will create provisioning profile automatically

### Option 3: Build ONNX Runtime from Source (Complex)

If you need TTS immediately:

1. **Clone and build ONNX Runtime**:
   ```bash
   git clone https://github.com/microsoft/onnxruntime.git
   cd onnxruntime
   ./build.sh --config Release --build_shared_lib --parallel --ios --ios_sysroot $(xcrun --show-sdk-path --sdk iphoneos) --minimal_build
   ```

2. **Point ort-sys to built library**:
   ```bash
   export ORT_LIB_LOCATION=/path/to/onnxruntime/build/iOS/Release
   ```

**Note**: This is a multi-hour build process and requires significant setup.

### Option 4: Use CoreML Models Directly (Best Long-term)

You already have CoreML models in `kokoro-82m-coreml/`. Consider:

1. **Create Swift/CoreML bindings** for iOS
2. **Use the existing CoreML models** instead of ONNX Runtime
3. **Bridge to Rust** via FFI if needed

This would be the most iOS-native approach.

## Quick Commands

```bash
# Clean everything
cd src-tauri
cargo clean
cd ..

# Try Xcode build
cd src-tauri/gen/apple
open tts-tauri.xcodeproj

# Or try Tauri CLI with verbose output
bun tauri ios build --target aarch64-apple-ios --verbose

# Check what targets are available
rustup target list | grep ios
```

## Next Steps

**Immediate**: Try **Option 2** (Xcode) - it often handles iOS builds better than CLI.

**Short-term**: Consider **Option 1** (disable TTS) to get a working build, then add TTS back.

**Long-term**: **Option 4** (CoreML directly) would be the best iOS-native solution.

