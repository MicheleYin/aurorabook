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
    
    // For iOS builds, merge espeak-rs-sys static libraries into libapp.a
    // because Rust staticlib doesn't automatically include linked static libraries
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-ios") {
        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "release".to_string());
        let target_dir = std::env::var("CARGO_TARGET_DIR")
            .or_else(|_| std::env::var("CARGO_BUILD_TARGET_DIR"))
            .unwrap_or_else(|_| "target".to_string());
        
        // Find espeak-rs-sys build output
        let build_pattern = format!("{}/{}/{}", target_dir, target, profile);
        let build_path = std::path::Path::new(&build_pattern);
        
        if let Ok(entries) = std::fs::read_dir(build_path.join("build")) {
            for entry in entries.flatten() {
                let dir_name = entry.file_name();
                if dir_name.to_string_lossy().starts_with("espeak-rs-sys-") {
                    let out_dir = entry.path().join("out");
                    
                    // Libraries to merge
                    let libs = vec![
                        out_dir.join("lib/libespeak-ng.a"),
                        out_dir.join("build/src/speechPlayer/libspeechPlayer.a"),
                        out_dir.join("build/src/ucd-tools/libucd.a"),
                    ];
                    
                    // Determine architecture (arm64 for aarch64-apple-ios)
                    let arch = if target.contains("aarch64") { "arm64" } else { "x86_64" };
                    let externals_dir = std::path::Path::new("gen/apple/Externals").join(arch).join(&profile);
                    let libapp_path = externals_dir.join("libapp.a");
                    
                    // Wait for libapp.a to be created, then merge libraries into it
                    // This will be done in a post-build script or we can use a different approach
                    // For now, just copy the libraries so they can be linked separately
                    if let Err(e) = std::fs::create_dir_all(&externals_dir) {
                        eprintln!("Warning: Could not create Externals directory: {}", e);
                        continue;
                    }
                    
                    for lib_path in &libs {
                        if lib_path.exists() {
                            let dest = externals_dir.join(lib_path.file_name().unwrap());
                            if let Err(e) = std::fs::copy(lib_path, &dest) {
                                eprintln!("Warning: Could not copy {} to {}: {}", lib_path.display(), dest.display(), e);
                            }
                        }
                    }
                    break;
                }
            }
        }
    }
    
    tauri_build::build()
}
