# Debugging Production Builds

This guide explains how to debug path resolution issues in production builds.

## Quick Start

### 1. Enable Verbose Logging

In production, you can enable verbose logging by setting the `RUST_LOG` environment variable before running the app:

```bash
# macOS/Linux
RUST_LOG=debug ./target/release/aurorabook

# Or export it first
export RUST_LOG=debug
./target/release/aurorabook
```

Available log levels (from least to most verbose):
- `error` - Only errors
- `warn` - Warnings and errors
- `info` - Info, warnings, and errors (default)
- `debug` - Debug info and above
- `trace` - Everything

### 2. Use the Diagnostic Command

The app now includes a diagnostic command that you can call from the frontend to check all path resolutions:

```typescript
import { invoke } from '@tauri-apps/api/core';

// Get path diagnostics
const diagnostics = await invoke('get_path_diagnostics');

console.log('Path Diagnostics:', diagnostics);
```

The diagnostics will show:
- Tauri resource directory path and any errors
- Current working directory
- All checked paths for:
  - ONNX models (`kokoro-v1.0.onnx`)
  - Voices files (`voices-v1.0.bin`)
  - G2P models (`model.fst`)
  - Piper TTS models (`mini-bart-g2p`)
  - ARPABET mapping files (`arpabet-mapping.txt`)

For each path, you'll see:
- `path`: The full path checked
- `exists`: Whether the path exists
- `is_file`: Whether it's a file
- `is_dir`: Whether it's a directory
- `error`: Any error message if the path doesn't exist

### 3. Check Console Logs

The app now logs detailed information about path resolution:

- **On startup**: Resource directory path and contents
- **When resolving paths**: All checked paths with existence status
- **On errors**: Detailed error messages with all checked paths

Look for log messages like:
- `✓ Set TAURI_RESOURCE_DIR to: ...`
- `✓ Found ONNX model at: ...`
- `❌ Resource path resolution failed: ...`

## Common Issues

### Issue: Resources Not Found in Production

**Symptoms**: App works in dev but fails in production with "Resource not found" errors.

**Debugging Steps**:

1. Check the diagnostic output:
   ```typescript
   const diag = await invoke('get_path_diagnostics');
   console.log('Resource dir:', diag.tauri_resource_dir);
   console.log('ONNX paths:', diag.onnx_paths);
   ```

2. Verify resources are bundled:
   - Check `tauri.conf.json` has resources listed in `bundle.resources`
   - Verify files exist in `src-tauri/resources/` directory
   - Rebuild the app: `tauri build`

3. Check resource directory path:
   - The diagnostic will show the exact path Tauri is using
   - Verify the path exists and contains the expected files

### Issue: Piper TTS Model Not Found

**Symptoms**: TTS works but phonemization fails.

**Debugging Steps**:

1. Check Piper model paths in diagnostics:
   ```typescript
   const diag = await invoke('get_path_diagnostics');
   console.log('Piper model paths:', diag.piper_model_paths);
   console.log('ARPABET mapping paths:', diag.arpabet_mapping_paths);
   ```

2. Verify `mini-bart-g2p` is bundled:
   - Check `tauri.conf.json` includes `resources/mini-bart-g2p/**/*`
   - Verify the directory structure matches what the code expects

3. Check environment variable:
   ```typescript
   console.log('TAURI_RESOURCE_DIR env:', diag.tauri_resource_dir_env);
   ```

## Logging to File (Optional)

To save logs to a file for later analysis, you can modify the logger initialization in `src-tauri/src/lib.rs`:

```rust
use std::fs::OpenOptions;
use std::io::Write;

// In the run() function, replace env_logger initialization with:
let log_file = app.path().app_log_dir()
    .ok()
    .and_then(|dir| {
        std::fs::create_dir_all(&dir).ok()?;
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("app.log"))
            .ok()
    });

env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
    .target(env_logger::Target::Pipe(Box::new(log_file.unwrap_or_else(|| {
        Box::new(std::io::stderr())
    }))))
    .init();
```

## Viewing Logs on macOS

### Console.app
1. Open Console.app (Applications > Utilities)
2. Filter by your app name: "AuroraBook"
3. Look for log messages with your app's process

### Terminal
```bash
# View system logs
log stream --predicate 'process == "AuroraBook"'

# Or view from a specific time
log show --predicate 'process == "AuroraBook"' --last 1h
```

## Testing Production Build Locally

To test a production build locally before distribution:

```bash
# Build in release mode
tauri build

# Run the built app with debug logging
RUST_LOG=debug ./src-tauri/target/release/aurorabook

# Or on macOS, run from the .app bundle
RUST_LOG=debug open src-tauri/target/release/bundle/macos/AuroraBook.app
```

## Key Differences: Dev vs Prod

| Aspect | Development | Production |
|--------|------------|------------|
| Resource Directory | `current_dir/src-tauri/resources/` | `app.path().resource_dir()` (bundled) |
| Current Working Dir | Project root | App bundle location |
| Logging | Console (stdout/stderr) | System logs (macOS) |
| Path Resolution | Relative to project | Relative to app bundle |

The diagnostic command will show you exactly which paths are being checked and which ones exist in your environment.


