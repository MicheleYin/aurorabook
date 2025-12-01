# ONNX Runtime Web - How It Works

## Overview

ONNX Runtime Web (`onnxruntime-web`) is a JavaScript/TypeScript library that enables running ONNX models directly in web browsers. It's a web-optimized version of ONNX Runtime that supports multiple execution backends for hardware acceleration.

## Architecture

### 1. **Package Structure**

```
onnxruntime-web/
├── onnxruntime-web/          # Main package (WASM backend)
├── onnxruntime-web/webgpu/   # WebGPU backend (experimental)
└── onnxruntime-common/       # Shared utilities
```

### 2. **Execution Backends**

ONNX Runtime Web supports three execution backends:

#### **A. WebAssembly (WASM) - Default**
- **Platform**: All modern browsers + Node.js
- **Performance**: CPU-based, moderate performance
- **Compatibility**: Universal support
- **Use Case**: Fallback when GPU is unavailable

```javascript
import * as ort from 'onnxruntime-web';
// Uses WASM backend by default
```

#### **B. WebGL - Legacy GPU**
- **Platform**: Most browsers (maintenance mode)
- **Performance**: GPU-accelerated via WebGL API
- **Status**: Deprecated in favor of WebGPU
- **Use Case**: Older browsers without WebGPU support

#### **C. WebGPU - Modern GPU (Experimental)**
- **Platform**: Chromium-based browsers (v113+)
- **Performance**: Modern GPU API, best performance
- **Requirements**: 
  - Chrome/Edge 113+ (Windows, macOS, Linux)
  - Chrome 121+ for Float16 support
  - Edge 122+ for Float16 support
- **Use Case**: Best performance for supported browsers

```javascript
import * as ort from 'onnxruntime-web/webgpu';
// Uses WebGPU backend
```

## How WebGPU Works in ONNX Runtime Web

### 1. **Browser API Integration**

ONNX Runtime Web uses the browser's native WebGPU API:

```javascript
// Detection (similar to kokoro.js)
const adapter = await navigator.gpu.requestAdapter();
if (adapter) {
  // WebGPU is available
}
```

### 2. **Execution Provider Registration**

When using the WebGPU module, ONNX Runtime Web automatically registers the WebGPU execution provider:

```javascript
import * as ort from 'onnxruntime-web/webgpu';

const session = await ort.InferenceSession.create('model.onnx', {
  executionProviders: ['webgpu'],  // Explicitly use WebGPU
  // or let it auto-detect
});
```

### 3. **How Hugging Face Transformers.js Uses It**

Transformers.js wraps `onnxruntime-web` and provides a higher-level API:

```javascript
// Transformers.js internally uses onnxruntime-web
import { pipeline } from '@huggingface/transformers';

const model = await pipeline('text-to-speech', 'model-id', {
  device: 'webgpu',  // Passed to onnxruntime-web
  dtype: 'fp32',     // Full precision for WebGPU
});
```

**Internal Flow:**
1. Transformers.js detects device capability
2. Loads appropriate `onnxruntime-web` module (WASM or WebGPU)
3. Creates ONNX Runtime session with appropriate EP
4. Handles tensor operations and model execution

## Technical Details

### 1. **WebGPU Execution Provider**

The WebGPU EP in ONNX Runtime Web:
- Uses browser's `navigator.gpu` API
- Compiles shaders for GPU execution
- Manages GPU memory and buffers
- Handles data transfer between CPU and GPU

### 2. **Data Types**

```javascript
// WASM backend - supports quantization
dtype: 'q8'   // 8-bit quantized (smaller, faster)
dtype: 'q4'   // 4-bit quantized (smallest)
dtype: 'fp32' // Full precision

// WebGPU backend - typically uses full precision
dtype: 'fp32' // Recommended for WebGPU
dtype: 'fp16' // Requires Chrome 121+ / Edge 122+
```

### 3. **Model Loading**

```javascript
// Option 1: Auto-detect backend
const session = await ort.InferenceSession.create('model.onnx');

// Option 2: Explicit backend selection
const session = await ort.InferenceSession.create('model.onnx', {
  executionProviders: ['webgpu'],
  // or
  executionProviders: ['wasm'],
});
```

### 4. **Inference**

```javascript
// Prepare inputs
const inputTensor = new ort.Tensor('float32', inputData, [1, 256]);

// Run inference
const outputs = await session.run({ input: inputTensor });

// Process outputs
const result = outputs.output.data;
```

## Comparison: Web vs Native

### ONNX Runtime Web (JavaScript/TypeScript)

| Aspect | Details |
|--------|---------|
| **Platform** | Browser/Web only |
| **Backends** | WASM, WebGL, WebGPU |
| **WebGPU** | ✅ Available via `onnxruntime-web/webgpu` |
| **Detection** | `navigator.gpu.requestAdapter()` |
| **Package** | `onnxruntime-web` (npm) |
| **Use Case** | Web applications, browser-based ML |

### ONNX Runtime Native (Rust/C++)

| Aspect | Details |
|--------|---------|
| **Platform** | Native apps (Windows, Linux, macOS, iOS) |
| **Backends** | CPU, CUDA, CoreML, DirectML, etc. |
| **WebGPU** | ✅ Available for WASM targets only |
| **Detection** | Feature flags + platform checks |
| **Package** | `ort` crate (Rust) |
| **Use Case** | Native applications, server-side |

## Key Differences

### 1. **WebGPU Availability**

**ONNX Runtime Web:**
- ✅ WebGPU EP available for all supported browsers
- Uses browser's native WebGPU API
- Works in Chromium-based browsers (v113+)

**ONNX Runtime Native (Rust):**
- ✅ WebGPU EP available for WASM targets (`target_arch = "wasm32"`)
- ❌ Not available for native macOS/iOS apps
- Uses same WebGPU API when compiled to WASM

### 2. **Platform Support**

**ONNX Runtime Web:**
```javascript
// Works in browsers
- Chrome/Edge 113+ (Windows, macOS, Linux)
- Safari (limited WebGPU support)
- Firefox (limited WebGPU support)
```

**ONNX Runtime Native:**
```rust
// Platform-specific EPs
- Windows: DirectML, CUDA
- Linux: CUDA, ROCm
- macOS/iOS: CoreML (uses Metal)
- WASM: WebGPU, WASM
```

### 3. **Integration**

**ONNX Runtime Web:**
- Direct JavaScript/TypeScript API
- Works with npm/yarn/pnpm
- Can be bundled with webpack/vite/rollup
- Used by Transformers.js

**ONNX Runtime Native:**
- Rust crate (`ort`)
- C/C++ bindings available
- Native compilation
- Used by Rust applications

## How kokoro.js Uses It

```javascript
// 1. Detection
const device = (await detectWebGPU()) ? "webgpu" : "wasm";

// 2. Model Loading (via Transformers.js)
const tts = await KokoroTTS.from_pretrained(model_id, {
  dtype: device === "wasm" ? "q8" : "fp32",
  device,  // "webgpu" or "wasm"
});

// 3. Transformers.js internally:
// - Loads onnxruntime-web/webgpu if device="webgpu"
// - Loads onnxruntime-web if device="wasm"
// - Creates session with appropriate execution provider
```

## Summary

**ONNX Runtime Web:**
- ✅ Web-optimized JavaScript library
- ✅ Supports WASM, WebGL, and WebGPU backends
- ✅ WebGPU available for Chromium browsers
- ✅ Used by Transformers.js and other web ML libraries
- ✅ Browser-based, no native compilation needed

**For Native macOS/iOS Apps:**
- Use **CoreML EP** (already configured) - leverages Metal for GPU
- Use **Candle with Metal** - direct Metal support
- WebGPU EP only available when compiling to WASM (not native apps)

The CoreML EP in your Rust implementation is the native equivalent of WebGPU for Apple platforms, providing GPU acceleration through Metal.

