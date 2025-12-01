# Development Guide

## Running with Rust Backend Logs

The Rust backend uses `env_logger` which reads from the `RUST_LOG` environment variable.

### Quick Start

```bash
# Debug level (recommended for development)
bun run dev:debug

# Trace level (very verbose, shows all logs)
bun run dev:trace

# Custom log filter (example: only conversion logs)
bun run dev:smil
```

### Manual RUST_LOG Configuration

You can also set `RUST_LOG` manually:

```bash
# Show all info and above logs
RUST_LOG=info bun tauri dev

# Show debug logs for everything
RUST_LOG=debug bun tauri dev

# Show trace logs (most verbose)
RUST_LOG=trace bun tauri dev

# Show logs for specific modules only
RUST_LOG=aurorabook::epub::converter=debug,aurorabook::tts=debug bun tauri dev

# Show logs for conversion and TTS
RUST_LOG=aurorabook::epub::converter=debug,aurorabook::tts=debug,aurorabook::tts::engine=debug bun tauri dev

# Show all logs except for noisy dependencies
RUST_LOG=debug,ort=warn,onnxruntime=warn bun tauri dev
```

### Log Levels

- `error` - Only errors
- `warn` - Warnings and errors
- `info` - Info, warnings, and errors (default)
- `debug` - Debug, info, warnings, and errors
- `trace` - All logs (very verbose)

### Useful Log Filters for Debugging

```bash
# Conversion-specific logs
RUST_LOG=aurorabook::epub::converter=debug,aurorabook::epub=info bun tauri dev

# TTS engine logs
RUST_LOG=aurorabook::tts=debug,aurorabook::tts::engine=debug bun tauri dev

# Book service logs
RUST_LOG=aurorabook::book_service=debug bun tauri dev

# All application logs at debug level
RUST_LOG=aurorabook=debug bun tauri dev
```

### Viewing Logs

When running `bun tauri dev`, Rust logs will appear in the terminal where you ran the command. They are prefixed with log levels:
- `[ERROR]` - Errors
- `[WARN]` - Warnings  
- `[INFO]` - Informational messages
- `[DEBUG]` - Debug information
- `[TRACE]` - Very detailed trace information

### Example Output

```
[INFO] Starting EPUB to audiobook conversion with 10 chapters
[INFO] Creating TTS engine pool with 8 instances using ONNX engine
[INFO] Model path: /path/to/kokoro-v1.0.onnx, Voices path: /path/to/voices-v1.0.bin
[INFO] Successfully created TTS engine pool with 8 instances for parallel processing
[DEBUG] Generating audio for chapter 1...
```

