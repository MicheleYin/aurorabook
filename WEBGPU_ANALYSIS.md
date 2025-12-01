# WebGPU Support Analysis: kokoro.js vs Rust Implementation

## How kokoro.js Handles WebGPU

### 1. **WebGPU Detection**
```javascript
// utils.js
export async function detectWebGPU() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch (e) {
    return false;
  }
}
```

### 2. **Device Selection**
```javascript
// worker.js
const device = (await detectWebGPU()) ? "webgpu" : "wasm";
const tts = await KokoroTTS.from_pretrained(model_id, {
  dtype: device === "wasm" ? "q8" : "fp32",  // Different data types
  device,  // "webgpu" or "wasm"
});
```

### 3. **Key Points**
- **Library**: Uses `@huggingface/transformers` (v3.5.1) which wraps `onnxruntime-web`
- **Detection**: Uses browser's `navigator.gpu.requestAdapter()` API
- **Data Types**: 
  - `"q8"` (quantized) for WASM backend
  - `"fp32"` (full precision) for WebGPU backend
- **Platform**: Web-only (browser environment)

## Differences from Rust Implementation

### Rust/ONNX Runtime WebGPU EP

1. **Target Platform**:
   - WebGPU EP in ONNX Runtime is primarily for **WASM targets** (`target_arch = "wasm32"`)
   - Also available with `load-dynamic` or `webgpu` feature flags
   - **Not directly available for native macOS/iOS apps**

2. **Platform Support**:
   ```rust
   // From ort/src/ep/webgpu.rs
   fn supported_by_platform(&self) -> bool {
       cfg!(any(target_os = "windows", target_os = "linux", target_arch = "wasm32"))
   }
   ```
   - ✅ Windows, Linux, WASM
   - ❌ Native macOS/iOS (use CoreML/Metal instead)

3. **Usage in Rust**:
   ```rust
   use ort::ep::WebGPU;
   
   let session = Session::builder()?
       .with_execution_providers([
           WebGPU::default().build()
       ])?
       .commit_from_file("model.onnx")?;
   ```

## For Native macOS/iOS Apps

### Current Approach (Recommended)
- **CoreML EP**: Uses Metal under the hood for GPU acceleration
  - Configured with `MLProgram` format
  - `CPUAndNeuralEngine` compute units
  - Automatically leverages GPU when available

### Alternative: Candle with Metal
- **Candle Engine**: Direct Metal support via `candle-core/metal` feature
  - More direct Metal access
  - Similar to PyTorch's MPS backend
  - Available in Rust codebase

## Summary

| Aspect | kokoro.js (Web) | Rust (Native) |
|--------|----------------|---------------|
| **Platform** | Browser/Web | Native macOS/iOS |
| **Detection** | `navigator.gpu.requestAdapter()` | Feature flags + platform checks |
| **WebGPU EP** | Via `onnxruntime-web` | Available for WASM only |
| **macOS GPU** | N/A (web only) | CoreML EP (uses Metal) or Candle Metal |
| **Data Types** | `q8` (WASM) / `fp32` (WebGPU) | `fp32` (CoreML/Candle) |

## Conclusion

For native macOS/iOS Rust applications:
- ✅ **Use CoreML EP** (already configured) - leverages Metal for GPU acceleration
- ✅ **Use Candle with Metal** (already available) - direct Metal support
- ❌ **WebGPU EP** - not available for native macOS/iOS (WASM only)

The CoreML EP configuration already provides GPU acceleration on Apple devices through Metal, which is the appropriate solution for native apps (similar to how kokoro.js uses WebGPU for web apps).

