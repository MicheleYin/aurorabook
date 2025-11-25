# iOS Code Signing Setup

## Quick Setup Steps

1. **Open Xcode Project**:
   ```bash
   open src-tauri/gen/apple/tts-tauri.xcodeproj
   ```

2. **In Xcode**:
   - Select the **tts-tauri_iOS** target in the left sidebar
   - Go to **Signing & Capabilities** tab
   - Check **"Automatically manage signing"**
   - Select your **Team** from the dropdown (your Apple ID)
   - Xcode will automatically create a provisioning profile

3. **If you don't have a team**:
   - You need an Apple ID (free)
   - Go to Xcode → Settings → Accounts
   - Add your Apple ID
   - Then select it in Signing & Capabilities

4. **After configuring**, try building again:
   ```bash
   export CMAKE_POLICY_VERSION_MINIMUM=3.5
   bun tauri ios build --target aarch64 --debug
   ```

## Alternative: Build for Simulator First

If you want to test without signing, build for simulator:

```bash
export CMAKE_POLICY_VERSION_MINIMUM=3.5
bun tauri ios build --target aarch64-sim --debug
```

This doesn't require code signing and can run on the iOS Simulator.

## Installing on Your Device

Once signing is configured:

1. Connect your iOS device via USB
2. Trust the computer on your device
3. In Xcode, select your device as the build destination
4. Build and run (⌘R) or use:
   ```bash
   bun tauri ios build --target aarch64 --debug
   ```

The app will be installed on your device automatically.


