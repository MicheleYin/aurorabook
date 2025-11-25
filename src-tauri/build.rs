fn main() {
    // Note: We're using kokoro-tiny crate which uses ONNX Runtime with CoreML Execution Provider
    // ONNX Runtime handles CoreML/Swift linking internally, so we don't need to link Swift here
    // The kokoro-tiny crate manages all the necessary dependencies
    
    // Link LAME library for MP3 encoding
    // Check common Homebrew installation paths
    let homebrew_prefixes = vec![
        "/opt/homebrew",  // Apple Silicon
        "/usr/local",     // Intel Mac
    ];
    
    for prefix in homebrew_prefixes {
        let lame_lib_path = format!("{}/opt/lame/lib", prefix);
        if std::path::Path::new(&lame_lib_path).exists() {
            println!("cargo:rustc-link-search=native={}", lame_lib_path);
            break;
        }
    }
    
    tauri_build::build()
}
