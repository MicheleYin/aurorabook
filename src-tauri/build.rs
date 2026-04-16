use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Copy Supertonic v2 assets from the repo’s `supertonic-2/` tree (Hugging Face layout) into
/// `src-tauri/resources/supertonic/` so Tauri can bundle them.
///
/// Expects `../../supertonic-2/onnx` and `../../supertonic-2/voice_styles` relative to this crate.
/// Pull large files with Git LFS from [Supertone/supertonic-2](https://huggingface.co/Supertone/supertonic-2).
fn sync_supertonic_assets_for_bundle() {
    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(s) => PathBuf::from(s),
        Err(_) => return,
    };
    // `src-tauri` crate dir → workspace root is two levels up (…/tts-tauri/src-tauri → aurorabook)
    let workspace_root = manifest_dir.join("..").join("..");
    let src_pack = workspace_root.join("supertonic-2");
    let src_onnx = src_pack.join("onnx");
    let src_voices = src_pack.join("voice_styles");

    if !src_onnx.is_dir() {
        eprintln!(
            "cargo:warning=Supertonic ONNX folder not found at {} — clone https://huggingface.co/Supertone/supertonic-2 into ./supertonic-2 (Git LFS for .onnx)",
            src_onnx.display()
        );
        return;
    }

    let dest_root = manifest_dir.join("resources").join("supertonic");
    let dest_onnx = dest_root.join("onnx");
    let dest_voices = dest_root.join("voice_styles");

    if let Err(e) = copy_dir_all(&src_onnx, &dest_onnx) {
        eprintln!(
            "cargo:warning=failed to sync Supertonic ONNX {} → {}: {}",
            src_onnx.display(),
            dest_onnx.display(),
            e
        );
    } else {
        println!(
            "cargo:warning=Synced Supertonic ONNX → {}",
            dest_onnx.display()
        );
    }

    if src_voices.is_dir() {
        if let Err(e) = copy_dir_all(&src_voices, &dest_voices) {
            eprintln!(
                "cargo:warning=failed to sync Supertonic voice_styles {} → {}: {}",
                src_voices.display(),
                dest_voices.display(),
                e
            );
        } else {
            println!(
                "cargo:warning=Synced Supertonic voice_styles → {}",
                dest_voices.display()
            );
        }
    } else {
        eprintln!(
            "cargo:warning=Supertonic voice_styles not found at {}",
            src_voices.display()
        );
    }

    if !dest_onnx.join("duration_predictor.onnx").exists() {
        println!(
            "cargo:warning=Supertonic ONNX weights missing (only JSON copied). In repo root: `cd supertonic-2 && git lfs pull`"
        );
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    if dst.exists() {
        fs::remove_dir_all(dst)?;
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn main() {
    // Build kai_* stub library for iOS (ARM SME symbols)
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-ios") {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        let stub_file = std::path::Path::new(&manifest_dir).join("kai_stubs.c");
        if stub_file.exists() {
            cc::Build::new()
                .file(&stub_file)
                .flag("-c")
                .compile("kai_stubs");
        }
    }

    // Supertonic (kokoros) uses ONNX Runtime; CoreML EP linking is handled below for iOS when ORT libs are present.

    // MP3 encoding is now handled by mp3lame-encoder crate which bundles LAME statically
    // No need to link system LAME library - the crate is fully self-contained

    // Handle ONNX Runtime linking for iOS
    // According to ort documentation: https://ort.pyke.io/setup/linking#static-linking
    // Use ORT_LIB_LOCATION to point ort-sys to the libraries
    // For iOS, also set ORT_LIB_PROFILE to specify the profile
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-ios") {
        // If ORT_LIB_LOCATION is not set, try to find and set it automatically
        if std::env::var("ORT_LIB_LOCATION").is_err() {
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
                // Relative to project root (most common) - Release build
                project_root
                    .join("onnxruntime")
                    .join("build")
                    .join("iOS")
                    .join("Release")
                    .join("Release-iphoneos"),
                // Workspace layout where ONNX Runtime sits beside tts-tauri/
                project_root
                    .parent()
                    .unwrap_or(project_root)
                    .join("onnxruntime")
                    .join("build")
                    .join("iOS")
                    .join("Release")
                    .join("Release-iphoneos"),
                // Alternative: build/iOS/Release/Release-iphoneos (if built in different location)
                project_root
                    .join("onnxruntime")
                    .join("build")
                    .join("iOS")
                    .join(&profile)
                    .join("Release-iphoneos"),
                // Debug build location
                project_root
                    .join("onnxruntime")
                    .join("build")
                    .join("iOS")
                    .join("Debug")
                    .join("Debug-iphoneos"),
                // Check if Release-iphoneos exists directly under build/iOS
                project_root
                    .join("onnxruntime")
                    .join("build")
                    .join("iOS")
                    .join("Release-iphoneos"),
            ];

            // Find ONNX Runtime libraries for iOS
            // iOS build structure: onnxruntime/build/iOS/Release/Release-iphoneos/
            let mut found_libs = false;
            for ort_lib_dir in &possible_paths {
                if ort_lib_dir.exists() && ort_lib_dir.join("libonnxruntime_common.a").exists() {
                    // Set ORT_LIB_LOCATION to the directory containing the libraries
                    // ort-sys will handle linking automatically
                    println!(
                        "cargo:warning=Found ONNX Runtime libraries at {}, setting ORT_LIB_LOCATION",
                        ort_lib_dir.display()
                    );
                    // Note: We can't set environment variables in build.rs that affect ort-sys's build.rs
                    // So we'll set it via cargo:rustc-env and also link manually as fallback
                    println!("cargo:rustc-env=ORT_LIB_LOCATION={}", ort_lib_dir.display());
                    println!("cargo:rustc-env=ORT_LIB_PROFILE=Release");

                    // Also set link search path and link libraries manually as ort-sys might not handle iOS structure
                    println!("cargo:rustc-link-search=native={}", ort_lib_dir.display());

                    // Find and link ONNX and protobuf dependencies
                    // These are in _deps subdirectories of the build directory
                    // Calculate build_dir once and reuse it for all dependency linking
                    // Path structure: onnxruntime/build/iOS/Release/Release-iphoneos
                    // We need: onnxruntime/build/iOS/Release (where _deps is located)
                    let build_dir = ort_lib_dir
                        .parent(); // Release-iphoneos -> Release (this is where _deps is)

                    if let Some(build_base) = &build_dir {
                        // Link ONNX libraries
                        let onnx_build_dir = build_base
                            .join("_deps")
                            .join("onnx-build")
                            .join("Release-iphoneos");
                        if onnx_build_dir.exists() {
                            println!(
                                "cargo:rustc-link-search=native={}",
                                onnx_build_dir.display()
                            );
                            if onnx_build_dir.join("libonnx.a").exists() {
                                println!("cargo:rustc-link-lib=static=onnx");
                            }
                            if onnx_build_dir.join("libonnx_proto.a").exists() {
                                println!("cargo:rustc-link-lib=static=onnx_proto");
                            }
                        }

                        // Link protobuf libraries
                        let protobuf_build_dir = build_base
                            .join("_deps")
                            .join("protobuf-build")
                            .join("Release-iphoneos");
                        if protobuf_build_dir.exists() {
                            println!(
                                "cargo:rustc-link-search=native={}",
                                protobuf_build_dir.display()
                            );
                            // Try protobuf-lite first (lighter), then protobuf
                            if protobuf_build_dir.join("libprotobuf-lite.a").exists() {
                                println!("cargo:rustc-link-lib=static=protobuf-lite");
                            } else if protobuf_build_dir.join("libprotobuf.a").exists() {
                                println!("cargo:rustc-link-lib=static=protobuf");
                            }
                        }
                    }

                    // Link individual static libraries (iOS builds don't create unified libonnxruntime.a)
                    // Order matters: link dependencies first, then libraries that depend on them
                    let core_libs = vec![
                        "onnxruntime_util",
                        "onnxruntime_common",
                        "onnxruntime_flatbuffers",
                        "onnxruntime_mlas",
                        "onnxruntime_graph",
                        "onnxruntime_optimizer",
                        "onnxruntime_framework",
                        "onnxruntime_providers",
                        "onnxruntime_lora", // LoRA adapters support
                        "onnxruntime_session", // Session should be last as it depends on others
                    ];

                    for lib in &core_libs {
                        let lib_path = ort_lib_dir.join(format!("lib{}.a", lib));
                        if lib_path.exists() {
                            println!("cargo:rustc-link-lib=static={}", lib);
                        }
                    }
                    
                    // Link RE2 regex library (required by ONNX Runtime)
                    if let Some(build_base) = &build_dir {
                        let re2_build_dir = build_base
                            .join("_deps")
                            .join("re2-build")
                            .join("Release-iphoneos");
                        if re2_build_dir.exists() {
                            println!(
                                "cargo:rustc-link-search=native={}",
                                re2_build_dir.display()
                            );
                            if re2_build_dir.join("libre2.a").exists() {
                                println!("cargo:rustc-link-lib=static=re2");
                            }
                        }
                        
                        // Link Abseil libraries (required by ONNX Runtime and RE2)
                        // Abseil libraries are in subdirectories: absl/<module>/Release-iphoneos/
                        let abseil_build_dir = build_base.join("_deps").join("abseil_cpp-build");
                        if abseil_build_dir.exists() {
                            // Recursively find all Release-iphoneos directories
                            use std::fs;
                            fn find_release_dirs(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
                                let mut result = Vec::new();
                                if let Ok(entries) = fs::read_dir(dir) {
                                    for entry in entries.flatten() {
                                        let path = entry.path();
                                        if path.is_dir() {
                                            let release_path = path.join("Release-iphoneos");
                                            if release_path.exists() {
                                                result.push(release_path);
                                            } else {
                                                // Recurse into subdirectories
                                                result.extend(find_release_dirs(&path));
                                            }
                                        }
                                    }
                                }
                                result
                            }
                            
                            let abseil_search_paths = find_release_dirs(&abseil_build_dir);
                            
                            // Add all search paths first
                            for search_path in &abseil_search_paths {
                                println!(
                                    "cargo:rustc-link-search=native={}",
                                    search_path.display()
                                );
                            }
                            
                            // Find and link all Abseil libraries
                            // This ensures all dependencies are satisfied
                            use std::collections::HashSet;
                            let mut linked_libs = HashSet::new();
                            
                            for search_path in &abseil_search_paths {
                                if let Ok(entries) = fs::read_dir(search_path) {
                                    for entry in entries.flatten() {
                                        let path = entry.path();
                                        if let Some(ext) = path.extension() {
                                            if ext == "a" {
                                                if let Some(file_name) = path.file_stem() {
                                                    if let Some(lib_name) = file_name.to_str() {
                                                        // Extract library name (remove lib prefix)
                                                        if let Some(name) = lib_name.strip_prefix("lib") {
                                                            if name.starts_with("absl_") && linked_libs.insert(name.to_string()) {
                                                                println!("cargo:rustc-link-lib=static={}", name);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Link XNNPACK provider if available (we built with --use_xnnpack)
                    // IMPORTANT: XNNPACK library must be linked AFTER the provider that uses it
                    let xnnpack_lib = ort_lib_dir.join("libonnxruntime_providers_xnnpack.a");
                    if xnnpack_lib.exists() {
                        // Link the provider first
                        println!("cargo:rustc-link-lib=static=onnxruntime_providers_xnnpack");
                        
                        // Then link XNNPACK library AFTER the provider (order matters!)
                        if let Some(build_base) = &build_dir {
                            let xnnpack_build_dir = build_base
                                .join("_deps")
                                .join("googlexnnpack-build")
                                .join("Release-iphoneos");
                            if xnnpack_build_dir.exists() {
                                // Set search path for XNNPACK
                                println!(
                                    "cargo:rustc-link-search=native={}",
                                    xnnpack_build_dir.display()
                                );
                                // Link XNNPACK (case-sensitive: libXNNPACK.a -> XNNPACK)
                                if xnnpack_build_dir.join("libXNNPACK.a").exists() {
                                    println!("cargo:rustc-link-lib=static=XNNPACK");
                                }
                                // Also link microkernels if available (link both variants)
                                if xnnpack_build_dir.join("libxnnpack-microkernels-prod.a").exists() {
                                    println!("cargo:rustc-link-lib=static=xnnpack-microkernels-prod");
                                }
                                if xnnpack_build_dir.join("libmicrokernels-prod.a").exists() {
                                    println!("cargo:rustc-link-lib=static=microkernels-prod");
                                }
                            }
                            
                            // Link cpuinfo library (required by XNNPACK)
                            let cpuinfo_build_dir = build_base
                                .join("_deps")
                                .join("pytorch_cpuinfo-build")
                                .join("Release-iphoneos");
                            if cpuinfo_build_dir.exists() {
                                println!(
                                    "cargo:rustc-link-search=native={}",
                                    cpuinfo_build_dir.display()
                                );
                                if cpuinfo_build_dir.join("libcpuinfo.a").exists() {
                                    println!("cargo:rustc-link-lib=static=cpuinfo");
                                }
                            }
                            
                            // Link pthreadpool library (required by XNNPACK provider)
                            let pthreadpool_build_dir = build_base
                                .join("_deps")
                                .join("pthreadpool-build")
                                .join("Release-iphoneos");
                            if pthreadpool_build_dir.exists() {
                                println!(
                                    "cargo:rustc-link-search=native={}",
                                    pthreadpool_build_dir.display()
                                );
                                if pthreadpool_build_dir.join("libpthreadpool.a").exists() {
                                    println!("cargo:rustc-link-lib=static=pthreadpool");
                                }
                            }
                        }
                    }

                    // Link CoreML provider if available
                    let coreml_lib = ort_lib_dir.join("libonnxruntime_providers_coreml.a");
                    if coreml_lib.exists() {
                        println!("cargo:rustc-link-lib=static=onnxruntime_providers_coreml");
                        println!("cargo:rustc-link-lib=framework=CoreML");
                    }

                    // Link required system frameworks
                    println!("cargo:rustc-link-lib=framework=Foundation");
                    println!("cargo:rustc-link-lib=c++");

                    found_libs = true;
                    break;
                }
            }

            if !found_libs {
                eprintln!("cargo:warning=ONNX Runtime libraries not found for iOS");
                eprintln!("cargo:warning=Set ORT_LIB_LOCATION environment variable or build ONNX Runtime first");
                eprintln!("cargo:warning=Run: ./scripts/build-onnxruntime-ios.sh");
            }
        }
    }

    sync_supertonic_assets_for_bundle();
    tauri_build::build()
}
