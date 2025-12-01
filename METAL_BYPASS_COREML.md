# Bypassing CoreML for Direct Metal GPU Access on macOS

## Answer: Yes! Use Candle with Metal

You already have **Candle with Metal support** implemented in your codebase! This provides **direct Metal GPU access** on macOS, bypassing CoreML entirely.

## Options for GPU on macOS

### 1. **CoreML EP (Current Default)**
- ✅ Uses Metal under the hood
- ✅ Well-tested and stable
- ❌ Goes through CoreML abstraction layer
- ❌ May have limitations with certain operators

### 2. **Candle with Metal (Direct Access)** ⭐
- ✅ **Direct Metal API access** - bypasses CoreML
- ✅ Similar to PyTorch's MPS backend
- ✅ More control over GPU operations
- ✅ Already implemented in your codebase
- ✅ Can be faster for some workloads

### 3. **WebGPU EP** ❌
- ❌ Only available for WASM targets (`target_arch = "wasm32"`)
- ❌ Not available for native macOS apps
- ❌ Even with `load-dynamic` feature, it's designed for WASM

## How to Use Candle with Metal

### 1. **Enable Metal Feature**

Build with the `metal` feature:

```bash
cd Kokoros/kokoros
cargo build --features metal
```

Or in your `Cargo.toml`:

```toml
[dependencies]
kokoros = { path = "../Kokoros/kokoros", features = ["metal"] }
```

### 2. **Use Candle Engine**

The Candle engine automatically uses Metal when:
- `metal` feature is enabled
- Running on macOS/iOS
- Metal device initialization succeeds

```rust
// Already implemented in candle_koko.rs
#[cfg(all(any(target_os = "macos", target_os = "ios"), feature = "metal"))]
let device = {
    use candle_core::MetalDevice;
    match MetalDevice::new(0) {
        Ok(metal_device) => {
            tracing::info!("Using Metal device for Candle inference (GPU acceleration enabled)");
            Device::Metal(metal_device)  // Direct Metal access!
        }
        Err(e) => {
            tracing::warn!("Failed to initialize Metal device: {}. Falling back to CPU.", e);
            Device::Cpu
        }
    }
};
```

### 3. **Use TTSKokoCandle**

Instead of `TTSKoko` (which uses ONNX Runtime with CoreML), use `TTSKokoCandle`:

```rust
use kokoros::tts::koko_candle::TTSKokoCandle;

// This uses Candle with Metal (direct GPU access)
let engine = TTSKokoCandle::new(
    model_path,
    voices_path,
).await;
```

## Comparison: CoreML vs Candle Metal

| Aspect | CoreML EP | Candle Metal |
|--------|-----------|--------------|
| **Metal Access** | Indirect (via CoreML) | Direct |
| **Abstraction** | CoreML layer | Direct Metal API |
| **Control** | Limited | Full control |
| **Performance** | Good | Can be better |
| **Compatibility** | Well-tested | Good |
| **Setup** | Built-in | Feature flag |

## Why Candle Metal Bypasses CoreML

1. **Direct Metal API**: Candle uses Metal directly via `candle-core/metal`
2. **No CoreML Layer**: Bypasses Apple's CoreML framework entirely
3. **Lower-Level Access**: More control over GPU operations
4. **Similar to PyTorch MPS**: Uses the same approach as PyTorch's MPS backend

## Implementation Details

### Candle Metal Device Creation

```rust
// From candle_koko.rs
use candle_core::MetalDevice;

// Create Metal device directly
let metal_device = MetalDevice::new(0)?;  // 0 = first GPU
let device = Device::Metal(metal_device);
```

### How It Works

1. **MetalDevice::new(0)**: Creates a Metal device for the first GPU
2. **Device::Metal**: Wraps it in Candle's Device enum
3. **Tensor Operations**: All operations run on Metal GPU
4. **No CoreML**: Completely bypasses CoreML framework

## Switching from CoreML to Candle Metal

### Option 1: Use Candle Engine Directly

```rust
// Instead of:
use kokoros::tts::koko::TTSKoko;  // Uses ONNX Runtime + CoreML

// Use:
use kokoros::tts::koko_candle::TTSKokoCandle;  // Uses Candle + Metal
```

### Option 2: Make Candle the Default

You could modify `ort_base.rs` to prefer Candle when Metal is available, but it's better to use the Candle engine directly since they're separate implementations.

## Performance Considerations

### When to Use Candle Metal:
- ✅ Want direct Metal control
- ✅ Need to bypass CoreML limitations
- ✅ Want PyTorch-like MPS behavior
- ✅ Fine-tuning GPU operations

### When to Use CoreML:
- ✅ Want maximum compatibility
- ✅ Prefer well-tested solution
- ✅ Need CoreML-specific optimizations
- ✅ Working with CoreML-optimized models

## Example: Using Candle with Metal

```rust
use kokoros::tts::koko_candle::{TTSKokoCandle, TTSOpts};

// Build with: cargo build --features metal
let engine = TTSKokoCandle::new(
    "path/to/model.onnx",
    "path/to/voices.bin",
).await;

let opts = TTSOpts {
    txt: "Hello, this is using direct Metal GPU!",
    lan: "en",
    style_name: "af_heart",
    save_path: "output.wav",
    mono: true,
    speed: 1.0,
    initial_silence: None,
};

engine.tts(opts)?;  // Runs on Metal GPU directly!
```

## Summary

**To bypass CoreML and get direct Metal GPU access on macOS:**

1. ✅ **Use Candle with Metal** (already implemented!)
2. ✅ Build with `--features metal`
3. ✅ Use `TTSKokoCandle` instead of `TTSKoko`
4. ✅ Metal device is created directly, bypassing CoreML

**This gives you:**
- Direct Metal API access
- No CoreML abstraction layer
- Full control over GPU operations
- Similar to PyTorch's MPS backend

The Candle Metal implementation is already in your codebase and ready to use!

