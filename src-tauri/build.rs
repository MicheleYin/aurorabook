fn main() {
    // Note: We're using kokoro-tiny crate which uses ONNX Runtime with CoreML Execution Provider
    // ONNX Runtime handles CoreML/Swift linking internally, so we don't need to link Swift here
    // The kokoro-tiny crate manages all the necessary dependencies

    // MP3 encoding is now handled by mp3lame-encoder crate which bundles LAME statically
    // No need to link system LAME library - the crate is fully self-contained

    // Handle ONNX Runtime linking for iOS when ORT_DIRECT_LINK is set
    // ort-sys's build.rs will skip linking when ORT_DIRECT_LINK is set,
    // so we need to link the libraries manually if they exist
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-ios") && std::env::var("ORT_DIRECT_LINK").is_ok() {
        // Get project root (parent of src-tauri)
        let manifest_dir =
            std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        let project_root = std::path::Path::new(&manifest_dir)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));

        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "release".to_string());

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
                println!(
                    "cargo:warning=Found ONNX Runtime libraries at {}, linking manually",
                    ort_lib_dir.display()
                );
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
                        eprintln!(
                            "cargo:warning=ONNX Runtime library {} not found at {}",
                            lib,
                            lib_path.display()
                        );
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

    tauri_build::build()
}
