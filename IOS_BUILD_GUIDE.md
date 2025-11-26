# iOS Build Guide for AuroraBook

This guide will help you build the AuroraBook app for iOS devices and simulators.

## Prerequisites

### 1. Required Software

- **Xcode** (latest version recommended)
  - Install from Mac App Store
  - Make sure to install command line tools: `xcode-select --install`
  
- **Rust** with iOS targets
  ```bash
  rustup target add aarch64-apple-ios
  rustup target add aarch64-apple-ios-sim
  ```

- **Bun** (already installed if you can run `bun` commands)

- **Tauri CLI** (already installed as dev dependency)

### 2. Apple Developer Account

- You need an Apple Developer account (free or paid)
- Your development team ID is configured in `tauri.conf.json` as `YOUR_OLD_TEAM_ID`
- Make sure your signing identity is set up in Xcode

## Build Commands

The project includes several npm scripts for building iOS:

### Build for iOS Device (Release)
```bash
bun run build:ios
```
This builds for `aarch64-apple-ios` target (physical devices).

### Build for iOS Simulator
```bash
bun run build:ios:sim
```
This builds for `aarch64-apple-ios-sim` target (simulators).

### Debug Builds
```bash
# Debug build for device
bun run build:ios:debug

# Debug build for simulator
bun run build:ios:sim:debug
```

### Open in Xcode
```bash
bun run ios:xcode
```
This opens the generated Xcode project where you can:
- Configure signing
- Build and run on devices/simulators
- Archive for App Store distribution

## Build Process

1. **Frontend Build**: The build scripts automatically run `bun run build` to compile the frontend
2. **Rust Compilation**: Tauri compiles the Rust code for the iOS target
3. **Xcode Project**: The iOS app is generated in `src-tauri/gen/apple/`

## Configuration

### Bundle Identifier
- Current: `com.bigemperor26.tauri`
- Configured in: `src-tauri/tauri.conf.json`

### iOS Deployment Target
- Minimum iOS version: **14.0**
- Configured in: `src-tauri/tauri.conf.json` and `src-tauri/gen/apple/project.yml`

### Code Signing

1. Open Xcode project:
   ```bash
   bun run ios:xcode
   ```

2. Select the `tts-tauri_iOS` target

3. Go to "Signing & Capabilities" tab

4. Select your development team

5. Xcode will automatically manage provisioning profiles

### Resources

The following resources are bundled with the iOS app:
- `kokoro-v1.0.onnx` - TTS model
- `voices-v1.0.bin` - Voice data
- `voice-samples/**/*.mp3` - Voice sample files

These are configured in `tauri.conf.json` under `bundle.resources`.

## Troubleshooting

### Build Errors

**Error: "No such module 'Tauri' or similar"**
- Make sure you've run `bun install` to install dependencies
- Regenerate the Xcode project: `bun tauri ios init` (if needed)

**Error: Code signing issues**
- Open Xcode and configure signing in "Signing & Capabilities"
- Make sure your Apple Developer account is added in Xcode Preferences
- Check that your team ID matches in `tauri.conf.json`

**Error: Rust compilation fails**
- Ensure iOS targets are installed: `rustup target list | grep ios`
- Install missing targets: `rustup target add aarch64-apple-ios`

**Error: CMake or build tool issues**
- Make sure Xcode command line tools are installed: `xcode-select --install`
- Check that `CMAKE_POLICY_VERSION_MINIMUM` is set (configured in `.cargo/config.toml`)

### Runtime Issues

**App crashes on launch**
- Check device logs in Xcode Console
- Verify all resources are bundled correctly
- Test on simulator first to rule out device-specific issues

**TTS not working**
- Verify model files are included in bundle
- Check that CoreML EP is available (iOS automatically uses it)
- Review console logs for ONNX Runtime errors

## Testing on Device

1. Connect your iOS device via USB
2. Trust the computer on your device
3. Open Xcode project: `bun run ios:xcode`
4. Select your device from the device list
5. Click Run (▶️) or press `Cmd+R`

## Testing on Simulator

1. Open Xcode project: `bun run ios:xcode`
2. Select a simulator from the device list (e.g., "iPhone 15 Pro")
3. Click Run (▶️) or press `Cmd+R`

## Distribution

### App Store Distribution

1. Build for release: `bun run build:ios`
2. Open Xcode project: `bun run ios:xcode`
3. Select "Any iOS Device" as target
4. Go to Product → Archive
5. Follow the App Store Connect workflow

### Ad Hoc Distribution

1. Build for release: `bun run build:ios`
2. Open Xcode project: `bun run ios:xcode`
3. Select your device
4. Archive and export for Ad Hoc distribution
5. Install via TestFlight or direct installation

## Architecture Notes

- **Device builds**: `aarch64-apple-ios` (ARM64 for physical devices)
- **Simulator builds**: `aarch64-apple-ios-sim` (ARM64 for Apple Silicon simulators)
- The app uses CoreML Execution Provider for ONNX Runtime on iOS (automatic)
- Metal framework is required (configured in Xcode project)

## Additional Resources

- [Tauri iOS Documentation](https://tauri.app/v1/guides/building/ios)
- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [Xcode Help](https://help.apple.com/xcode/)

## Quick Start

For a quick test build:

```bash
# Build frontend
bun run build

# Build iOS app for simulator
bun run build:ios:sim

# Open in Xcode to run
bun run ios:xcode
```

Then in Xcode, select a simulator and press `Cmd+R` to run!

