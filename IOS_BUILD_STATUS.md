# iOS Build Status

## Setup Completed ✅

1. **Tauri Configuration**: Updated `tauri.conf.json` (removed invalid iOS config)
2. **CMake Fix**: Created `.cargo/config.toml` to fix espeak-rs-sys CMake compatibility
3. **Build Scripts**: Added iOS build scripts to `package.json`:
   - `bun run build:ios` - Build for physical iOS device
   - `bun run build:ios:sim` - Build for iOS simulator
   - `bun run build:ios:debug` - Debug build for device
   - `bun run build:ios:sim:debug` - Debug build for simulator
   - `bun run ios:xcode` - Open Xcode project

## Current Build Issues

### 1. ONNX Runtime (ort-sys) - No iOS Prebuilt Binaries
**Error**: `downloaded binaries not available for target aarch64-apple-ios-sim`

**Status**: ONNX Runtime doesn't provide prebuilt binaries for iOS. This affects the `kokoros` crate which depends on `ort`.

### 2. espeak-rs-sys - Target Triple Issue
**Error**: `error: version 'sim' in target triple 'arm64-apple-ios-sim' is invalid`

**Status**: The espeak-rs-sys crate has issues with the iOS simulator target triple.

## Solutions

### Option 1: Build for Physical Device (Try First)
Physical device builds sometimes work better than simulator:

```bash
bun run build:ios:debug
```

This requires:
- iOS device connected via USB
- Code signing configured in Xcode
- Development team selected

### Option 2: Use Xcode Directly (Recommended)
Xcode often handles iOS builds better than CLI:

```bash
bun run ios:xcode
```

Then in Xcode:
1. Select your iOS device or simulator
2. Go to **Product > Build** (⌘B)
3. Configure signing in **Signing & Capabilities** tab

### Option 3: Make TTS Optional for iOS
If you want a reader-only iOS build first:

1. Make `kokoros` optional in `Cargo.toml`:
   ```toml
   [features]
   default = []
   tts = ["kokoros"]
   
   [dependencies]
   kokoros = { path = "../Kokoros/kokoros", default-features = true, optional = true }
   ```

2. Build without TTS:
   ```bash
   bun tauri ios build --target aarch64-sim --debug --no-default-features
   ```

### Option 4: Build ONNX Runtime from Source
This is complex and time-consuming (multi-hour build):

```bash
git clone https://github.com/microsoft/onnxruntime.git
cd onnxruntime
./build.sh --config Release --build_shared_lib --parallel --ios --ios_sysroot $(xcrun --show-sdk-path --sdk iphoneos) --minimal_build
export ORT_LIB_LOCATION=/path/to/onnxruntime/build/iOS/Release
```

### Option 5: Use CoreML Models Directly (Best Long-term)
You have CoreML models in `Kokoro-82M-v1.0-ONNX/`. Consider:
- Creating Swift/CoreML bindings for iOS
- Using CoreML models instead of ONNX Runtime
- Bridging to Rust via FFI if needed

## Next Steps

1. **Immediate**: Try `bun run ios:xcode` and build in Xcode
2. **Short-term**: Consider Option 3 (make TTS optional) to get a working build
3. **Long-term**: Option 5 (CoreML directly) would be the most iOS-native solution

## Files Modified

- `src-tauri/tauri.conf.json` - Removed invalid iOS config
- `src-tauri/.cargo/config.toml` - Added CMake policy fix
- `package.json` - Added iOS build scripts

