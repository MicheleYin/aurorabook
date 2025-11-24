fn main() {
    // Note: We're using kokoros crate which uses ONNX Runtime with CoreML Execution Provider
    // ONNX Runtime handles CoreML/Swift linking internally, so we don't need to link Swift here
    // The kokoros crate manages all the necessary dependencies
    
    tauri_build::build()
}
