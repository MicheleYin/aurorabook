use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use crate::utils::errors::{AppError, AppResult};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};

/// Diagnostic information about path resolution.
#[derive(Debug, Serialize, Deserialize)]
pub struct PathDiagnostics {
    pub tauri_resource_dir: Option<String>,
    pub tauri_resource_dir_error: Option<String>,
    pub current_working_dir: Option<String>,
    pub current_working_dir_error: Option<String>,
    pub tauri_resource_dir_env: Option<String>,
    pub onnx_paths: Vec<PathCheck>,
    pub voices_paths: Vec<PathCheck>,
}

/// Information about a single path check.
#[derive(Debug, Serialize, Deserialize)]
pub struct PathCheck {
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub is_dir: bool,
    pub error: Option<String>,
}

/// Check a single path and return diagnostic information.
/// Supertonic expects a directory containing `tts.json`, `unicode_indexer.json`, and the four ONNX graphs.
fn is_supertonic_onnx_dir(p: &Path) -> bool {
    p.is_dir()
        && p.join("tts.json").exists()
        && p.join("duration_predictor.onnx").exists()
}

fn is_supertonic_voice_bundle_dir(p: &Path) -> bool {
    if !p.is_dir() {
        return false;
    }
    let nested = p.join("voice_styles");
    if nested.is_dir() {
        return std::fs::read_dir(&nested).map_or(false, |d| {
            d.flatten().any(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        });
    }
    std::fs::read_dir(p).map_or(false, |d| {
        d.flatten().any(|e| {
            let path = e.path();
            path.extension().and_then(|x| x.to_str()) == Some("json")
                && path.file_stem().and_then(|s| s.to_str()) != Some("voice_map")
        })
    })
}

/// Strip Windows `\\?\` extended-length prefixes so downstream APIs (ORT) get normal paths.
fn normalize_local_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

fn check_path(path: &Path) -> PathCheck {
    let path_str = path.display().to_string();
    match path.metadata() {
        Ok(metadata) => {
            PathCheck {
                path: path_str,
                exists: true,
                is_file: metadata.is_file(),
                is_dir: metadata.is_dir(),
                error: None,
            }
        }
        Err(e) => {
            PathCheck {
                path: path_str,
                exists: false,
                is_file: false,
                is_dir: false,
                error: Some(format!("{}", e)),
            }
        }
    }
}

/// Resolves paths for TTS model and voice files.
///
/// This utility struct provides methods to locate TTS model files
/// (ONNX models and voice data) in various locations, supporting both
/// development and production environments.
pub struct ResourcePathResolver;

impl ResourcePathResolver {
    /// Find Supertonic ONNX directory and voice bundle directory.
    ///
    /// Search order:
    /// 1. `SUPERTONIC_ONNX_DIR` / `SUPERTONIC_VOICES_DIR`
    /// 2. `KOKORO_MODEL_DIR` (if it points at a Supertonic ONNX folder) / `KOKORO_VOICES_PATH` (voice bundle dir)
    /// 3. Tauri resource directory (`supertonic/onnx`, `supertonic/voice_styles`, etc.)
    /// 4. Current working directory (`src-tauri/resources/...`)
    ///
    /// # Arguments
    /// * `app` - Optional Tauri AppHandle for accessing resource directories
    ///
    /// # Returns
    /// A tuple of `(onnx_dir, voices_dir)` when both directories are valid.
    ///
    /// # Errors
    /// Returns `AppError::ResourceNotFound` if either file cannot be found
    /// in any of the search locations. The error message includes all
    /// paths that were checked.
    ///
    /// # Example
    /// ```rust
    /// let (onnx_path, voices_path) = ResourcePathResolver::find_model_and_voices(Some(&app))?;
    /// println!("Using model: {}", onnx_path.display());
    /// ```
    pub fn find_model_and_voices(app: Option<&AppHandle>) -> AppResult<(PathBuf, PathBuf)> {
        let mut possible_onnx_dirs: Vec<PathBuf> = Vec::new();
        let mut possible_voice_dirs: Vec<PathBuf> = Vec::new();

        if let Ok(p) = std::env::var("SUPERTONIC_ONNX_DIR") {
            if !p.is_empty() {
                possible_onnx_dirs.push(PathBuf::from(p));
            }
        }
        if let Ok(p) = std::env::var("SUPERTONIC_VOICES_DIR") {
            if !p.is_empty() {
                possible_voice_dirs.push(PathBuf::from(p));
            }
        }

        if let Ok(env_dir) = std::env::var("KOKORO_MODEL_DIR") {
            if !env_dir.is_empty() {
                let b = PathBuf::from(env_dir);
                if is_supertonic_onnx_dir(&b) {
                    possible_onnx_dirs.push(b);
                }
            }
        }
        if let Ok(env_voices) = std::env::var("KOKORO_VOICES_PATH") {
            if !env_voices.is_empty() {
                possible_voice_dirs.push(PathBuf::from(env_voices));
            }
        }

        if let Some(app) = app {
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    log::info!("✓ Tauri resource directory: {}", resource_dir.display());
                    let res = resource_dir.join("resources");
                    possible_onnx_dirs.push(resource_dir.join("supertonic").join("onnx"));
                    possible_onnx_dirs.push(res.join("supertonic").join("onnx"));
                    possible_onnx_dirs.push(resource_dir.join("onnx"));
                    possible_onnx_dirs.push(res.join("onnx"));

                    possible_voice_dirs.push(resource_dir.join("supertonic").join("voice_styles"));
                    possible_voice_dirs.push(res.join("supertonic").join("voice_styles"));
                    possible_voice_dirs.push(resource_dir.join("voice_styles"));
                    possible_voice_dirs.push(res.join("voice_styles"));
                }
                Err(e) => log::warn!("⚠ Failed to get Tauri resource directory: {}", e),
            }
        } else {
            log::debug!("No AppHandle provided, skipping Tauri resource directory check");
        }

        if let Ok(current_dir) = std::env::current_dir() {
            let st = current_dir.join("src-tauri").join("resources");
            possible_onnx_dirs.push(st.join("supertonic").join("onnx"));
            possible_onnx_dirs.push(st.join("onnx"));
            possible_onnx_dirs.push(current_dir.join("resources").join("supertonic").join("onnx"));
            possible_voice_dirs.push(st.join("supertonic").join("voice_styles"));
            possible_voice_dirs.push(st.join("voice_styles"));
            possible_voice_dirs.push(current_dir.join("resources").join("supertonic").join("voice_styles"));
        }

        let onnx_dir = possible_onnx_dirs
            .iter()
            .find(|p| is_supertonic_onnx_dir(p))
            .cloned();

        let voices_dir = possible_voice_dirs
            .iter()
            .find(|p| is_supertonic_voice_bundle_dir(p))
            .cloned();

        match (onnx_dir, voices_dir) {
            (Some(onnx), Some(voices)) => {
                let onnx = normalize_local_path(onnx);
                let voices = normalize_local_path(voices);
                log::info!("✓ Found Supertonic ONNX directory at: {}", onnx.display());
                log::info!("✓ Found Supertonic voice bundle at: {}", voices.display());
                Ok((onnx, voices))
            }
            _ => {
                let mut error_msg =
                    "Could not find Supertonic assets. Expected an ONNX directory (tts.json + *.onnx) and a voice bundle (voice_styles/*.json).\n".to_string();
                error_msg.push_str("Checked ONNX directory candidates:\n");
                for path in &possible_onnx_dirs {
                    error_msg.push_str(&format!(
                        "  - {} (valid: {})\n",
                        path.display(),
                        is_supertonic_onnx_dir(path)
                    ));
                }
                error_msg.push_str("Checked voice bundle candidates:\n");
                for path in &possible_voice_dirs {
                    error_msg.push_str(&format!(
                        "  - {} (valid: {})\n",
                        path.display(),
                        is_supertonic_voice_bundle_dir(path)
                    ));
                }
                log::error!("{}", error_msg);
                Err(AppError::ResourceNotFound(error_msg))
            }
        }
    }

    /// Normalize a file path by removing URL scheme prefix and decoding URL-encoded characters.
    ///
    /// On iOS, file pickers return paths with `file://` prefix and URL-encoded characters.
    /// Paths with whitespace can cause issues on iOS if not properly handled. This function
    /// ensures proper normalization:
    /// - Removing `file://` or `file:///` prefix (iOS uses `file:///` for local files)
    /// - Decoding all percent-encoded characters:
    ///   - Spaces: `%20` → ` ` (space)
    ///   - Other whitespace: `%09` → `\t` (tab), `%0A` → `\n` (newline)
    ///   - Unicode characters: `%E2%80%93` → `–` (en dash)
    ///   - Emoji: `%F0%9F%98%80` → `😀` (grinning face)
    ///   - All other URL-encoded sequences
    ///
    /// **Important for iOS**: After normalization, use `normalize_to_pathbuf()` to convert
    /// to `PathBuf` for file operations, as `PathBuf` properly handles whitespace in paths.
    ///
    /// # Arguments
    /// * `path` - The file path to normalize (may include `file://` prefix and URL encoding)
    ///
    /// # Returns
    /// A normalized path string with URL scheme removed and all characters decoded.
    ///
    /// # Examples
    /// ```rust
    /// // Space in filename
    /// let normalized = ResourcePathResolver::normalize_file_path("file:///path/to/file%20with%20spaces.epub");
    /// // Returns: "/path/to/file with spaces.epub"
    ///
    /// // Emoji in filename
    /// let normalized = ResourcePathResolver::normalize_file_path("file:///path/to/book%F0%9F%93%9A.epub");
    /// // Returns: "/path/to/book📚.epub"
    ///
    /// // Unicode characters
    /// let normalized = ResourcePathResolver::normalize_file_path("file:///path/to/caf%C3%A9.epub");
    /// // Returns: "/path/to/café.epub"
    /// ```
    pub fn normalize_file_path(path: &str) -> String {
        // Remove file:// prefix if present.
        // iOS file pickers return `file:///abs/path` (three slashes = empty host + absolute path).
        // Strip only the scheme (`file://`) so the leading `/` of absolute paths is preserved:
        //   file:///Users/x/book.epub → /Users/x/book.epub
        let without_scheme = if let Some(rest) = path.strip_prefix("file://") {
            rest.to_string()
        } else {
            path.to_string()
        };

        // Decode all URL-encoded characters
        // percent_decode_str decodes all percent-encoded sequences (e.g., %20, %E2%80%93, %F0%9F%98%80)
        // decode_utf8_lossy converts the decoded bytes to UTF-8 string, handling Unicode and emoji
        percent_decode_str(&without_scheme)
            .decode_utf8_lossy()
            .to_string()
    }

    /// Convert a path to a PathBuf, ensuring proper handling of whitespace on iOS.
    ///
    /// On iOS, paths with spaces can cause issues if not properly handled.
    /// This function ensures paths are normalized and converted to PathBuf,
    /// which handles whitespace correctly in Rust file operations.
    ///
    /// # Arguments
    /// * `path` - The file path (may include `file://` prefix and URL encoding)
    ///
    /// # Returns
    /// A `PathBuf` with the normalized path, ready for file system operations.
    ///
    /// # Examples
    /// ```rust
    /// let path_buf = ResourcePathResolver::normalize_to_pathbuf("file:///path/to/file%20with%20spaces.epub");
    /// // PathBuf handles spaces correctly in file operations
    /// ```
    pub fn normalize_to_pathbuf(path: &str) -> PathBuf {
        let normalized = Self::normalize_file_path(path);
        PathBuf::from(normalized)
    }

    /// Validate and canonicalize a file path.
    ///
    /// This function validates that a path exists, resolves symlinks and
    /// relative paths, and optionally ensures the path is within a specified
    /// base directory (for security).
    ///
    /// # Arguments
    /// * `path` - The file path to validate (can include `file://` prefix)
    /// * `allowed_base` - Optional base directory to restrict the path to
    ///
    /// # Returns
    /// A canonicalized `PathBuf` if the path is valid and (if specified) within the base directory.
    ///
    /// # Errors
    /// Returns `AppError::ResourceNotFound` if the path doesn't exist.
    /// Returns `AppError::InvalidPath` if the path is outside the allowed base directory.
    /// Returns `AppError::Io` if path canonicalization fails.
    ///
    /// # Example
    /// ```rust
    /// let base = Path::new("/safe/directory");
    /// let path = ResourcePathResolver::validate_path("file.txt", Some(base))?;
    /// ```
    pub fn validate_path(path: &str, allowed_base: Option<&Path>) -> AppResult<PathBuf> {
        // Normalize the path (remove file:// prefix and decode URL encoding)
        let clean_path = Self::normalize_file_path(path);
        let path_buf = PathBuf::from(&clean_path);
        
        // Check if path exists
        if !path_buf.exists() {
            return Err(AppError::ResourceNotFound(format!("Path does not exist: {}", clean_path)));
        }

        // Canonicalize to resolve symlinks and relative paths
        let canonical = path_buf.canonicalize()
            .map_err(|e| AppError::Io(e).with_context(format!("Failed to canonicalize path: {}", clean_path)))?;

        // If allowed_base is specified, ensure the path is within it
        if let Some(base) = allowed_base {
            let canonical_base = base.canonicalize()
                .map_err(|e| AppError::Io(e).with_context(format!("Failed to canonicalize base path: {}", base.display())))?;
            
            if !canonical.starts_with(&canonical_base) {
                return Err(AppError::InvalidPath(format!(
                    "Path {} is outside allowed directory {}",
                    canonical.display(),
                    canonical_base.display()
                )));
            }
        }

        Ok(canonical)
    }
}

/// Debugging: list candidate Supertonic paths and whether they exist.
#[tauri::command]
pub fn get_path_diagnostics(app: AppHandle) -> PathDiagnostics {
    let mut diagnostics = PathDiagnostics {
        tauri_resource_dir: None,
        tauri_resource_dir_error: None,
        current_working_dir: None,
        current_working_dir_error: None,
        tauri_resource_dir_env: std::env::var("TAURI_RESOURCE_DIR").ok(),
        onnx_paths: Vec::new(),
        voices_paths: Vec::new(),
    };

    match app.path().resource_dir() {
        Ok(resource_dir) => {
            diagnostics.tauri_resource_dir = Some(resource_dir.display().to_string());
        }
        Err(e) => {
            diagnostics.tauri_resource_dir_error = Some(format!("{}", e));
        }
    }

    match std::env::current_dir() {
        Ok(cwd) => {
            diagnostics.current_working_dir = Some(cwd.display().to_string());
        }
        Err(e) => {
            diagnostics.current_working_dir_error = Some(format!("{}", e));
        }
    }

    let mut onnx_paths = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        onnx_paths.push(resource_dir.join("supertonic").join("onnx"));
        onnx_paths.push(resource_dir.join("resources").join("supertonic").join("onnx"));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        onnx_paths.push(
            current_dir
                .join("src-tauri")
                .join("resources")
                .join("supertonic")
                .join("onnx"),
        );
    }
    if let Ok(p) = std::env::var("SUPERTONIC_ONNX_DIR") {
        if !p.is_empty() {
            onnx_paths.push(PathBuf::from(p));
        }
    }
    diagnostics.onnx_paths = onnx_paths.iter().map(|p| check_path(p)).collect();

    let mut voices_paths = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        voices_paths.push(resource_dir.join("supertonic").join("voice_styles"));
        voices_paths.push(
            resource_dir
                .join("resources")
                .join("supertonic")
                .join("voice_styles"),
        );
    }
    if let Ok(current_dir) = std::env::current_dir() {
        voices_paths.push(
            current_dir
                .join("src-tauri")
                .join("resources")
                .join("supertonic")
                .join("voice_styles"),
        );
    }
    if let Ok(p) = std::env::var("SUPERTONIC_VOICES_DIR") {
        if !p.is_empty() {
            voices_paths.push(PathBuf::from(p));
        }
    }
    if let Ok(env_voices) = std::env::var("KOKORO_VOICES_PATH") {
        if !env_voices.is_empty() {
            voices_paths.push(PathBuf::from(env_voices));
        }
    }
    diagnostics.voices_paths = voices_paths.iter().map(|p| check_path(p)).collect();

    diagnostics
}
