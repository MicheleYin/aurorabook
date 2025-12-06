# iOS Build Issues and Solutions

## Issues Found

### 1. iOS Deployment Target Mismatch
**Problem**: ONNX Runtime libraries were built for iOS 15.1, but the project is configured for iOS 14.0.

**Error**: 
```
ld: warning: object file (...) was built for newer 'iOS' version (15.1) than being linked (14.0)
```

**Solution**: Updated `src-tauri/gen/apple/project.yml` to set deployment target to iOS 15.1.

### 2. Archive Failure (Exit Code 65)
**Problem**: Xcode archive is failing, which typically indicates:
- Code signing issues
- Missing provisioning profiles
- Configuration problems

**Solution**: 
- Ensure you have a valid provisioning profile for your development team (YOUR_OLD_TEAM_ID)
- Check that your Apple Developer account has proper certificates
- Verify the bundle identifier matches your provisioning profile

### 3. Module Cache Warnings
**Problem**: Swift module cache warnings (not critical, but noisy)

**Note**: These are warnings and shouldn't prevent the build, but they indicate the build system is looking for module cache files that don't exist.

## Steps to Fix

1. **Update iOS Deployment Target** (Already done)
   - Changed from iOS 14.0 to iOS 15.1 in `project.yml`

2. **Regenerate Xcode Project**
   ```bash
   bun tauri ios xcode
   ```

3. **Check Code Signing**
   - Open the Xcode project: `bun run ios:xcode`
   - Go to Signing & Capabilities
   - Ensure "Automatically manage signing" is enabled
   - Verify your team (YOUR_OLD_TEAM_ID) is selected
   - Check that a valid provisioning profile is available

4. **Clean and Rebuild**
   ```bash
   # Clean build artifacts
   rm -rf src-tauri/target/aarch64-apple-ios
   rm -rf src-tauri/gen/apple
   
   # Rebuild
   bun run build:ios
   ```

5. **Alternative: Build for Simulator First**
   ```bash
   bun run build:ios:sim
   ```
   This doesn't require code signing and can help verify the build process works.

## Additional Notes

- The `tauri-plugin-os` plugin should work on iOS, but if you encounter issues, you may need to conditionally register it only on desktop platforms
- The ONNX Runtime dependency requires iOS 15.1+, so the deployment target must match
- Make sure you have the latest Xcode and iOS SDK installed

