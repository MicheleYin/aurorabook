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
    copy_ort_webgpu_dylib_for_macos_bundle();
    ensure_macos_ffmpeg_resource();
    strip_ffmpeg_from_ios_assets();
    tauri_build::build()
}

/// `tauri.macos.conf.json` lists `resources/ffmpeg` as a bundle resource, so the path must
/// exist before `tauri_build::build()` or the build fails with
/// `resource path resources/ffmpeg doesn't exist`.
///
/// Prefer an existing non-empty binary, then env overrides, then a system `ffmpeg` on PATH.
fn ensure_macos_ffmpeg_resource() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if !target.contains("apple-darwin") {
        return;
    }

    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(s) => PathBuf::from(s),
        Err(_) => return,
    };
    let dest = manifest_dir.join("resources").join("ffmpeg");

    let dest_ok = dest.is_file()
        && fs::metadata(&dest)
            .map(|m| m.len() > 0)
            .unwrap_or(false);
    if dest_ok {
        return;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    for key in ["AURORABOOK_FFMPEG", "MACOS_APPSTORE_FFMPEG"] {
        if let Ok(p) = std::env::var(key) {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed));
            }
        }
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/ffmpeg"),
        PathBuf::from("/usr/local/bin/ffmpeg"),
        PathBuf::from("/usr/bin/ffmpeg"),
    ]);
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in path_env.split(':') {
            if dir.is_empty() {
                continue;
            }
            candidates.push(PathBuf::from(dir).join("ffmpeg"));
        }
    }

    for src in candidates {
        if !src.is_file() {
            continue;
        }
        if let Ok(meta) = fs::metadata(&src) {
            if meta.len() == 0 {
                continue;
            }
        }
        if let Some(parent) = dest.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                eprintln!(
                    "cargo:warning=ffmpeg resource: failed to create {}: {}",
                    parent.display(),
                    e
                );
                return;
            }
        }
        match fs::copy(&src, &dest) {
            Ok(_) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(meta) = fs::metadata(&dest) {
                        let mut perms = meta.permissions();
                        perms.set_mode(perms.mode() | 0o755);
                        let _ = fs::set_permissions(&dest, perms);
                    }
                }
                println!(
                    "cargo:warning=Copied ffmpeg for macOS bundle resource: {} → {}",
                    src.display(),
                    dest.display()
                );
                println!("cargo:rerun-if-changed={}", src.display());
                return;
            }
            Err(e) => eprintln!(
                "cargo:warning=ffmpeg resource: failed to copy {} → {}: {}",
                src.display(),
                dest.display(),
                e
            ),
        }
    }

    // Last resort: non-empty placeholder so `tauri_build` path validation passes.
    // Runtime detection ignores empty/invalid binaries and falls back to PATH.
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::write(&dest, b"#!/bin/sh\necho 'placeholder ffmpeg; install a real binary' >&2\nexit 1\n") {
        Ok(()) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = fs::metadata(&dest) {
                    let mut perms = meta.permissions();
                    perms.set_mode(perms.mode() | 0o755);
                    let _ = fs::set_permissions(&dest, perms);
                }
            }
            eprintln!(
                "cargo:warning=Created placeholder {} — install ffmpeg (e.g. brew install ffmpeg) or set AURORABOOK_FFMPEG for a real binary",
                dest.display()
            );
        }
        Err(e) => eprintln!(
            "cargo:warning=ffmpeg resource missing at {} and could not create placeholder: {}",
            dest.display(),
            e
        ),
    }
}

/// iOS App Store rejects standalone binaries like `ffmpeg` inside the app bundle.
/// Stale copies can linger under `gen/apple/assets` after older configs; remove them
/// before `tauri_build` stages resources for Xcode.
fn strip_ffmpeg_from_ios_assets() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if !target.contains("apple-ios") {
        return;
    }

    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(s) => PathBuf::from(s),
        Err(_) => return,
    };

    let candidates = [manifest_dir
        .join("gen")
        .join("apple")
        .join("assets")
        .join("resources")
        .join("ffmpeg")];

    for path in candidates {
        if path.is_file() {
            match fs::remove_file(&path) {
                Ok(()) => println!(
                    "cargo:warning=Removed ffmpeg from iOS bundle path {}",
                    path.display()
                ),
                Err(e) => eprintln!(
                    "cargo:warning=Failed to remove iOS-forbidden ffmpeg at {}: {}",
                    path.display(),
                    e
                ),
            }
        }
    }
}

/// `ort` + `webgpu` links `libwebgpu_dawn.dylib` via `@rpath`; Tauri validates `bundle.resources`
/// paths during this build script, so the dylib must exist before `tauri_build::build()`.
/// (See `.cargo/config.toml` rpath + `tauri.macos.conf.json` resources.)
fn copy_ort_webgpu_dylib_for_macos_bundle() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if !target.contains("apple-darwin") {
        return;
    }

    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(s) => PathBuf::from(s),
        Err(_) => return,
    };
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    // Match `src-tauri/.cargo/config.toml` `[build] target-dir = "../../.cargo-target"`.
    // Build scripts do not always get `CARGO_TARGET_DIR`, so fall back to the same layout.
    let cargo_target_from_config = manifest_dir
        .join("..")
        .join("..")
        .join(".cargo-target")
        .canonicalize()
        .unwrap_or_else(|_| manifest_dir.join("..").join("..").join(".cargo-target"));

    let mut target_roots: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = std::env::var("CARGO_TARGET_DIR") {
        target_roots.push(PathBuf::from(dir));
    }
    target_roots.push(cargo_target_from_config);
    target_roots.push(manifest_dir.join("target"));

    let dest_dir = manifest_dir.join("resources").join("ort-dylibs");
    let dest = dest_dir.join("libwebgpu_dawn.dylib");

    'outer: for target_dir in &target_roots {
        let candidates = [
            target_dir.join(&profile).join("libwebgpu_dawn.dylib"),
            target_dir.join(&target).join(&profile).join("libwebgpu_dawn.dylib"),
        ];
        for src in candidates.iter() {
            if !src.is_file() {
                continue;
            }
            if let Err(e) = fs::create_dir_all(&dest_dir) {
                eprintln!(
                    "cargo:warning=ort-dylibs: failed to create {}: {}",
                    dest_dir.display(),
                    e
                );
                return;
            }
            match fs::copy(src, &dest) {
                Ok(_) => {
                    println!("cargo:rerun-if-changed={}", src.display());
                    break 'outer;
                }
                Err(e) => eprintln!(
                    "cargo:warning=ort-dylibs: failed to copy {} → {}: {}",
                    src.display(),
                    dest.display(),
                    e
                ),
            }
        }
    }

    if !dest.is_file() {
        eprintln!(
            "cargo:warning=libwebgpu_dawn.dylib not found under any of {:?} (profile={}); ort (webgpu) must have been built first",
            target_roots,
            profile
        );
    }
}
