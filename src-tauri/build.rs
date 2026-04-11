use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// eSpeak-ng loads voice/phoneme data from disk at runtime (see `espeak-rs` / `PIPER_ESPEAKNG_DATA_DIRECTORY`).
/// After `espeak-rs-sys` builds, copy that tree into `resources/espeak-ng-data` so Tauri can bundle it.
fn sync_espeak_ng_data_for_bundle() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-ios") {
        return;
    }

    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(s) => PathBuf::from(s),
        Err(_) => return,
    };
    let dest_root = manifest_dir.join("resources").join("espeak-ng-data");

    // Prefer CARGO_TARGET_DIR, but also check the repo's `.cargo-target` when tools override
    // CARGO_TARGET_DIR (e.g. sandbox) while espeak-rs-sys artifacts live next to the project.
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let fallback_target = manifest_dir
        .join("..")
        .join("..")
        .join(".cargo-target")
        .join(&profile);

    let mut target_roots: Vec<PathBuf> = Vec::new();
    if let Ok(t) = std::env::var("CARGO_TARGET_DIR") {
        target_roots.push(PathBuf::from(t));
    }
    if !target_roots.iter().any(|p| p == &fallback_target) {
        target_roots.push(fallback_target);
    }

    let Some(src_root) = target_roots
        .iter()
        .find_map(|root| find_built_espeak_ng_data(root))
    else {
        eprintln!(
            "cargo:warning=espeak-ng-data not found under any of: {:?} — run cargo build so espeak-rs-sys completes first",
            target_roots
        );
        return;
    };

    if should_skip_sync(&src_root, &dest_root) {
        return;
    }

    let readme_src = manifest_dir.join("resources/espeak-ng-data/README.md");
    let readme_backup = fs::read(&readme_src).ok();

    if let Err(e) = copy_dir_all(&src_root, &dest_root) {
        eprintln!(
            "cargo:warning=failed to sync espeak-ng-data to {}: {}",
            dest_root.display(),
            e
        );
        return;
    }

    if let Some(bytes) = readme_backup {
        let _ = fs::write(dest_root.join("README.md"), bytes);
    }

    eprintln!(
        "cargo:warning=Synced espeak-ng-data into {} for Tauri bundle / dev resources",
        dest_root.display()
    );
}

fn find_built_espeak_ng_data(target_dir: &Path) -> Option<PathBuf> {
    let build_dir = target_dir.join("build");
    let entries = fs::read_dir(&build_dir).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("espeak-rs-sys-") {
            continue;
        }
        let base = entry.path().join("out");
        for rel in ["build/espeak-ng-data", "share/espeak-ng-data"] {
            let cand = base.join(rel);
            let phondata = cand.join("phondata");
            if cand.is_dir() && phondata.is_file() {
                let Ok(mtime) = fs::metadata(&phondata).and_then(|m| m.modified()) else {
                    continue;
                };
                best = match best {
                    None => Some((mtime, cand)),
                    Some((t0, _)) if mtime > t0 => Some((mtime, cand)),
                    Some(prev) => Some(prev),
                };
            }
        }
    }
    best.map(|(_, p)| p)
}

fn should_skip_sync(src_root: &Path, dest_root: &Path) -> bool {
    let dest_phondata = dest_root.join("phondata");
    let Ok(src_meta) = fs::metadata(src_root.join("phondata")) else {
        return true;
    };
    let Ok(dest_meta) = fs::metadata(&dest_phondata) else {
        return false;
    };
    let (Ok(st), Ok(dt)) = (src_meta.modified(), dest_meta.modified()) else {
        return false;
    };
    dt >= st
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

    // Note: We're using kokoro-tiny crate which uses ONNX Runtime with CoreML Execution Provider
    // ONNX Runtime handles CoreML/Swift linking internally, so we don't need to link Swift here
    // The kokoro-tiny crate manages all the necessary dependencies

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

    sync_espeak_ng_data_for_bundle();
    tauri_build::build()
}
