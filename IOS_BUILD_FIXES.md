# iOS Build Issues - Summary and Fixes

## Current Issues

### 1. Architecture Extraction Error
**Error**: `Arch specified by Xcode was invalid. {arch} isn't a known arch`

**Root Cause**: The build script in `project.yml` uses `${ARCHS:?}` which expands incorrectly when ARCHS is an array. Xcode is passing "0" "arm64" instead of just "arm64".

**Location**: `src-tauri/gen/apple/project.yml` line 84

**Current Script**:
```yaml
- script: bun tauri ios xcode-script ... ${ARCHS:?}
```

**Problem**: `${ARCHS:?}` expands to the entire ARCHS array, causing the script to receive multiple arguments incorrectly.

### 2. iOS Deployment Target
**Status**: ✅ Fixed - Set to iOS 15.1 in `tauri.conf.json`

### 3. Duplicate Copy Commands (Previous Issue)
**Status**: This was resolved by cleaning the Externals directory, but may recur if both debug and release builds exist.

## Solutions

### Option 1: Manual Fix (Temporary)
Since `project.yml` is auto-generated, you can manually fix it after generation:

1. After running `bun tauri ios init`, edit `src-tauri/gen/apple/project.yml`
2. Change line 84 from:
   ```yaml
   - script: bun tauri ios xcode-script ... ${ARCHS:?}
   ```
   To:
   ```yaml
   - script: |
       ARCH="${ARCHS%% *}"
       bun tauri ios xcode-script -v --platform ${PLATFORM_DISPLAY_NAME:?} --sdk-root ${SDKROOT:?} --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" --header-search-paths "${HEADER_SEARCH_PATHS:?}" --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" --configuration ${CONFIGURATION:?} ${FORCE_COLOR} "${ARCH}"
   ```

### Option 2: Use Simulator Build (No Code Signing)
Try building for simulator first to verify the build process:
```bash
bun run build:ios:sim
```

### Option 3: Report to Tauri
This appears to be a bug in Tauri's iOS project generation. The `${ARCHS:?}` expansion should extract just the first architecture, not the entire array.

## Next Steps

1. Try the manual fix in Option 1
2. If that works, consider filing an issue with Tauri about the ARCHS expansion
3. As a workaround, you could create a script that patches the generated project.yml

