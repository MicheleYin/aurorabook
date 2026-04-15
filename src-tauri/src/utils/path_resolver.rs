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
    /// Find ONNX model and voices file paths.
    ///
    /// This function searches for model files in multiple locations in order:
    /// 1. Tauri resource directory (if AppHandle is provided)
    /// 2. Current working directory (development mode)
    /// 3. Environment variables (`KOKORO_MODEL_PATH`, `KOKORO_VOICES_PATH`)
    /// 4. Home directory (`.aurorabook/`)
    ///
    /// # Arguments
    /// * `app` - Optional Tauri AppHandle for accessing resource directories
    ///
    /// # Returns
    /// A tuple of `(onnx_path, voices_path)` if both files are found.
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
        let mut possible_onnx_paths: Vec<PathBuf> = Vec::new();
        let mut possible_voices_paths: Vec<PathBuf> = Vec::new();

        // Try resource directory from app handle
        if let Some(app) = app {
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    log::info!("✓ Tauri resource directory: {}", resource_dir.display());
                    possible_onnx_paths.push(resource_dir.join("kokoro-v1.0.onnx"));
                    possible_onnx_paths.push(resource_dir.join("resources").join("kokoro-v1.0.onnx"));
                    possible_voices_paths.push(resource_dir.join("voices"));
                    possible_voices_paths.push(resource_dir.join("resources").join("voices"));
                    possible_voices_paths.push(resource_dir.join("voices-v1.0.bin"));
                    possible_voices_paths.push(resource_dir.join("resources").join("voices-v1.0.bin"));
                }
                Err(e) => {
                    log::warn!("⚠ Failed to get Tauri resource directory: {}", e);
                }
            }
        } else {
            log::debug!("No AppHandle provided, skipping Tauri resource directory check");
        }

        // Try current directory (dev mode)
        match std::env::current_dir() {
            Ok(current_dir) => {
                log::debug!("Current working directory: {}", current_dir.display());
                possible_onnx_paths.push(
                    current_dir
                        .join("src-tauri")
                        .join("resources")
                        .join("kokoro-v1.0.onnx"),
                );
                possible_onnx_paths.push(current_dir.join("resources").join("kokoro-v1.0.onnx"));
                possible_voices_paths.push(
                    current_dir
                        .join("src-tauri")
                        .join("resources")
                        .join("voices"),
                );
                possible_voices_paths.push(current_dir.join("resources").join("voices"));
                possible_voices_paths.push(
                    current_dir
                        .join("src-tauri")
                        .join("resources")
                        .join("voices-v1.0.bin"),
                );
                possible_voices_paths.push(current_dir.join("resources").join("voices-v1.0.bin"));
            }
            Err(e) => {
                log::warn!("⚠ Failed to get current working directory: {}", e);
            }
        }

        // Try environment variables
        if let Ok(env_path) = std::env::var("KOKORO_MODEL_PATH") {
            if !env_path.is_empty() {
                possible_onnx_paths.push(PathBuf::from(env_path));
            }
        }
        if let Ok(env_voices) = std::env::var("KOKORO_VOICES_PATH") {
            if !env_voices.is_empty() {
                possible_voices_paths.push(PathBuf::from(env_voices));
            }
        }

        // Try KOKORO_MODEL_DIR (for ONNX model)
        if let Ok(env_dir) = std::env::var("KOKORO_MODEL_DIR") {
            if !env_dir.is_empty() {
                let env_buf = PathBuf::from(&env_dir);
                if env_buf.is_file() && env_buf.extension().and_then(|s| s.to_str()) == Some("onnx") {
                    possible_onnx_paths.push(env_buf);
                } else if env_buf.is_dir() {
                    possible_onnx_paths.push(env_buf.join("kokoro-v1.0.onnx"));
                }
            }
        }

        let onnx_path = possible_onnx_paths
            .iter()
            .find(|p| p.exists() && p.is_file())
            .cloned();

        let voices_path = possible_voices_paths
            .iter()
            .find(|p| p.exists())
            .cloned();

        match (onnx_path, voices_path) {
            (Some(onnx), Some(voices)) => {
                log::info!("✓ Found ONNX model at: {}", onnx.display());
                log::info!("✓ Found voices at: {}", voices.display());
                Ok((onnx, voices))
            },
            _ => {
                let mut error_msg = "Could not find required files. Checked paths:\n".to_string();
                error_msg.push_str("ONNX model paths:\n");
                for path in &possible_onnx_paths {
                    let exists = path.exists();
                    let is_file = exists && path.is_file();
                    error_msg.push_str(&format!("  - {} (exists: {}, is_file: {})\n", 
                        path.display(), exists, is_file));
                    log::debug!("  ONNX path: {} (exists: {}, is_file: {})", 
                        path.display(), exists, is_file);
                }
                error_msg.push_str("Voices file paths:\n");
                for path in &possible_voices_paths {
                    let exists = path.exists();
                    let is_file = exists && path.is_file();
                    error_msg.push_str(&format!("  - {} (exists: {}, is_file: {})\n", 
                        path.display(), exists, is_file));
                    log::debug!("  Voices path: {} (exists: {}, is_file: {})", 
                        path.display(), exists, is_file);
                }
                log::error!("❌ Resource path resolution failed:\n{}", error_msg);
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
        // Remove file:// or file:/// prefix if present
        // iOS file picker returns file:/// (three slashes) for local files
        let without_scheme = if path.starts_with("file:///") {
            // file:///path -> /path (keep the leading slash)
            path.replacen("file:///", "", 1)
        } else if path.starts_with("file://") {
            // file://path -> path (no leading slash, less common on iOS)
            path.replacen("file://", "", 1)
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

    /// Parent directory `P` such that `P/espeak-ng-data` exists on disk.
    ///
    /// Tauri bundles `tauri.conf.json` `bundle.resources` under
    /// `resource_dir/resources/` on macOS (e.g. `Contents/Resources/resources/`),
    /// while `resource_dir()` alone is `Contents/Resources`. Misaki / `espeak-rs`
    /// expect [`PIPER_ESPEAKNG_DATA_DIRECTORY`](https://crates.io/crates/espeak-rs)
    /// to be that parent (not the inner `espeak-ng-data` folder).
    pub fn espeak_ng_piper_data_directory(resource_dir: &Path) -> Option<PathBuf> {
        let nested = resource_dir.join("resources").join("espeak-ng-data");
        if nested.is_dir() {
            return Some(resource_dir.join("resources"));
        }
        let flat = resource_dir.join("espeak-ng-data");
        if flat.is_dir() {
            return Some(resource_dir.to_path_buf());
        }
        None
    }

    /// Resolve the eSpeak-ng bundle parent using the app resource dir, then dev `cwd` fallbacks
    /// (`src-tauri/resources`, `./resources`).
    pub fn resolve_espeak_ng_piper_directory(app: &AppHandle) -> Option<PathBuf> {
        if let Ok(rd) = app.path().resource_dir() {
            if let Some(p) = Self::espeak_ng_piper_data_directory(&rd) {
                return Some(p);
            }
        }
        let cwd = std::env::current_dir().ok()?;
        for base in [
            cwd.join("src-tauri").join("resources"),
            cwd.join("resources"),
        ] {
            if base.join("espeak-ng-data").is_dir() {
                return Some(base);
            }
        }
        None
    }
}

    /// Get comprehensive path resolution diagnostics.
    ///
    /// This function checks all possible paths for TTS resources and returns
    /// detailed information about what exists and what doesn't. Useful for
    /// debugging production build issues.
    ///
    /// # Arguments
    /// * `app` - Tauri AppHandle
    ///
    /// # Returns
    /// A `PathDiagnostics` struct with all path information.
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

        // Check Tauri resource directory
        match app.path().resource_dir() {
            Ok(resource_dir) => {
                diagnostics.tauri_resource_dir = Some(resource_dir.display().to_string());
            }
            Err(e) => {
                diagnostics.tauri_resource_dir_error = Some(format!("{}", e));
            }
        }

        // Check current working directory
        match std::env::current_dir() {
            Ok(cwd) => {
                diagnostics.current_working_dir = Some(cwd.display().to_string());
            }
            Err(e) => {
                diagnostics.current_working_dir_error = Some(format!("{}", e));
            }
        }

        // Check ONNX model paths
        let mut onnx_paths = Vec::new();
        if let Ok(resource_dir) = app.path().resource_dir() {
            onnx_paths.push(resource_dir.join("kokoro-v1.0.onnx"));
            onnx_paths.push(resource_dir.join("resources").join("kokoro-v1.0.onnx"));
        }
        if let Ok(current_dir) = std::env::current_dir() {
            onnx_paths.push(current_dir.join("src-tauri").join("resources").join("kokoro-v1.0.onnx"));
            onnx_paths.push(current_dir.join("resources").join("kokoro-v1.0.onnx"));
        }
        if let Ok(env_path) = std::env::var("KOKORO_MODEL_PATH") {
            if !env_path.is_empty() {
                onnx_paths.push(PathBuf::from(env_path));
            }
        }
        diagnostics.onnx_paths = onnx_paths.iter().map(|p| check_path(p)).collect();

        // Check voices paths
        let mut voices_paths = Vec::new();
        if let Ok(resource_dir) = app.path().resource_dir() {
            voices_paths.push(resource_dir.join("voices-v1.0.bin"));
            voices_paths.push(resource_dir.join("resources").join("voices-v1.0.bin"));
        }
        if let Ok(current_dir) = std::env::current_dir() {
            voices_paths.push(current_dir.join("src-tauri").join("resources").join("voices-v1.0.bin"));
            voices_paths.push(current_dir.join("resources").join("voices-v1.0.bin"));
        }
        if let Ok(env_voices) = std::env::var("KOKORO_VOICES_PATH") {
            if !env_voices.is_empty() {
                voices_paths.push(PathBuf::from(env_voices));
            }
        }
        diagnostics.voices_paths = voices_paths.iter().map(|p| check_path(p)).collect();

        diagnostics
    }

