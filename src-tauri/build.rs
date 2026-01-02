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
        
        // Handle ONNX Runtime linking for iOS when ORT_DIRECT_LINK is set
        // ort-sys's build.rs will skip linking when ORT_DIRECT_LINK is set,
        // so we need to link the libraries manually if they exist
        if std::env::var("ORT_DIRECT_LINK").is_ok() {
            // Get project root (parent of src-tauri)
            let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
            let project_root = std::path::Path::new(&manifest_dir)
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."));
            
            // Try to find ONNX Runtime libraries in common locations
            // Based on ONNX Runtime build structure: build/iOS/Release/Release-iphoneos/
            let possible_paths: Vec<std::path::PathBuf> = vec![
                // Relative to project root (most common)
                project_root.join("onnxruntime").join("build").join("iOS").join("Release").join("Release-iphoneos"),
                // Alternative: build/iOS/Release/Release-iphoneos (if built in different location)
                project_root.join("onnxruntime").join("build").join("iOS").join(&profile).join("Release-iphoneos"),
                // Debug build location
                project_root.join("onnxruntime").join("build").join("iOS").join("Debug").join("Debug-iphoneos"),
                // Absolute path fallback
                std::path::PathBuf::from("/Users/micheleyin/Documents/tts-tauri/onnxruntime/build/iOS/Release/Release-iphoneos"),
            ];
            
            let mut found_libs = false;
            for ort_lib_dir in &possible_paths {
                if ort_lib_dir.exists() && ort_lib_dir.join("libonnxruntime_common.a").exists() {
                    println!("cargo:warning=Found ONNX Runtime libraries at {}, linking manually", ort_lib_dir.display());
                    println!("cargo:rustc-link-search=native={}", ort_lib_dir.display());
                    
                    // Link the required ONNX Runtime static libraries
                    // Core libraries
                    let core_libs = vec![
                        "onnxruntime_common",
                        "onnxruntime_flatbuffers",
                        "onnxruntime_framework",
                        "onnxruntime_graph",
                        "onnxruntime_mlas",
                        "onnxruntime_optimizer",
                        "onnxruntime_providers",
                        "onnxruntime_session",
                        "onnxruntime_util",
                    ];
                    
                    for lib in &core_libs {
                        let lib_path = ort_lib_dir.join(format!("lib{}.a", lib));
                        if lib_path.exists() {
                            println!("cargo:rustc-link-lib=static={}", lib);
                        } else {
                            eprintln!("cargo:warning=ONNX Runtime library {} not found at {}", lib, lib_path.display());
                        }
                    }
                    
                    // Link CoreML provider if available (required for iOS)
                    let coreml_lib = ort_lib_dir.join("libonnxruntime_providers_coreml.a");
                    if coreml_lib.exists() {
                        println!("cargo:rustc-link-lib=static=onnxruntime_providers_coreml");
                        println!("cargo:rustc-link-lib=framework=CoreML");
                    } else {
                        eprintln!("cargo:warning=CoreML provider not found - build ONNX Runtime with --use_coreml flag");
                    }
                    
                    // Link required system frameworks for iOS
                    println!("cargo:rustc-link-lib=framework=Foundation");
                    println!("cargo:rustc-link-lib=c++");
                    
                    found_libs = true;
                    break;
                }
            }
            
            if !found_libs {
                eprintln!("cargo:warning=ORT_DIRECT_LINK is set but ONNX Runtime libraries not found for iOS");
                eprintln!("cargo:warning=You need to build ONNX Runtime for iOS first");
                eprintln!("cargo:warning=Run: ./scripts/build-onnxruntime-ios.sh");
                eprintln!("cargo:warning=Or manually build with:");
                eprintln!("cargo:warning=  cd onnxruntime");
                eprintln!("cargo:warning=  ./build.sh --config Release --use_xcode --ios --apple_sysroot iphoneos --osx_arch arm64 --apple_deploy_target 15.1 --use_coreml");
                eprintln!("cargo:warning=Expected location: onnxruntime/build/iOS/Release/Release-iphoneos/");
                // Don't fail the build, just warn - the linking will fail later if libraries are truly missing
            }
        }
        
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
                    let _libapp_path = externals_dir.join("libapp.a");
                    
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
