# Fixing espeak-rs-sys iOS Build Issue

## Problem
The `espeak-rs-sys` crate fails to build for iOS due to CMake compatibility issues:
```
CMake Error at CMakeLists.txt:1 (cmake_minimum_required):
  Compatibility with CMake < 3.5 has been removed from CMake.
```

## Solution

The espeak-ng source bundled in `espeak-rs-sys` has an old CMakeLists.txt. We need to set CMake policy to allow it to build.

### Option 1: Set CMake Policy Environment Variable (Recommended)

Set this environment variable before building:

```bash
export CMAKE_POLICY_VERSION_MINIMUM=3.5
```

Then build:
```bash
cd src-tauri
cargo build --target aarch64-apple-ios --lib
```

### Option 2: Patch the Crate (More Permanent)

1. Find the espeak-ng source in the cargo cache:
   ```bash
   find ~/.cargo/registry -name "CMakeLists.txt" -path "*/espeak-rs-sys*/opus/CMakeLists.txt" | head -1
   ```

2. Edit the CMakeLists.txt file and change:
   ```cmake
   cmake_minimum_required(VERSION 2.8)
   ```
   to:
   ```cmake
   cmake_minimum_required(VERSION 3.5)
   ```

### Option 3: Use Cargo Patch (Best for Project)

Add to `src-tauri/Cargo.toml`:

```toml
[patch.crates-io]
# Patch espeak-rs-sys to fix CMake compatibility
espeak-rs-sys = { git = "https://github.com/your-fork/espeak-rs-sys", branch = "fix-cmake-ios" }
```

Or create a local patch by:
1. Fork espeak-rs-sys
2. Update the bundled espeak-ng CMakeLists.txt
3. Use the patch above

### Option 4: Build Script Workaround

Create `src-tauri/build.rs` modification or use a `.cargo/config.toml`:

```toml
[env]
CMAKE_POLICY_VERSION_MINIMUM = "3.5"
```

## Quick Fix Command

Run this before building:

```bash
export CMAKE_POLICY_VERSION_MINIMUM=3.5
cd /Users/micheleyin/Documents/tts-tauri/src-tauri
cargo build --target aarch64-apple-ios --lib
```

## For Xcode Builds

Add to your Xcode build script or `src-tauri/gen/apple/project.yml`:

```yaml
environmentVariables:
  CMAKE_POLICY_VERSION_MINIMUM: "3.5"
```


