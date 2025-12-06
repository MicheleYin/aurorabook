use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use crate::utils::errors::{AppError, AppResult};

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
            if let Ok(resource_dir) = app.path().resource_dir() {
                possible_onnx_paths.push(resource_dir.join("kokoro-v1.0.onnx"));
                possible_onnx_paths.push(resource_dir.join("resources").join("kokoro-v1.0.onnx"));
                possible_voices_paths.push(resource_dir.join("voices-v1.0.bin"));
                possible_voices_paths.push(resource_dir.join("resources").join("voices-v1.0.bin"));
            }
        }

        // Try current directory (dev mode)
        if let Ok(current_dir) = std::env::current_dir() {
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
                    .join("voices-v1.0.bin"),
            );
            possible_voices_paths.push(current_dir.join("resources").join("voices-v1.0.bin"));
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
            .find(|p| p.exists() && p.is_file())
            .cloned();

        match (onnx_path, voices_path) {
            (Some(onnx), Some(voices)) => Ok((onnx, voices)),
            _ => {
                let mut error_msg = "Could not find required files. Checked paths:\n".to_string();
                error_msg.push_str("ONNX model paths:\n");
                for path in &possible_onnx_paths {
                    error_msg.push_str(&format!("  - {}\n", path.display()));
                }
                error_msg.push_str("Voices file paths:\n");
                for path in &possible_voices_paths {
                    error_msg.push_str(&format!("  - {}\n", path.display()));
                }
                Err(AppError::ResourceNotFound(error_msg))
            }
        }
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
        // Remove file:// prefix if present
        let clean_path = if path.starts_with("file://") {
            path.replacen("file://", "", 1)
        } else {
            path.to_string()
        };

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

    /// Find G2P (Phonetisaurus) model file path.
    ///
    /// This function searches for G2P model files in multiple locations in order:
    /// 1. Tauri resource directory (if AppHandle is provided) - for bundled apps
    /// 2. Current working directory (development mode)
    /// 3. Environment variable (`G2P_MODEL_DIR`)
    ///
    /// # Arguments
    /// * `app` - Optional Tauri AppHandle for accessing resource directories
    /// * `language` - Language code (e.g., "en-gb", "en-us")
    ///
    /// # Returns
    /// Path to the model.fst file if found.
    ///
    /// # Errors
    /// Returns `AppError::ResourceNotFound` if the model cannot be found.
    pub fn find_g2p_model(app: Option<&AppHandle>, language: &str) -> AppResult<PathBuf> {
        // Map language codes to MFA model directory names
        let mfa_model_dir = match language {
            "en" | "en-us" => "english_us_mfa",
            "en-gb" => "english_uk_mfa",
            _ => {
                return Err(AppError::ResourceNotFound(format!(
                    "Unsupported language code for G2P: {}",
                    language
                )));
            }
        };

        let mut possible_paths: Vec<PathBuf> = Vec::new();

        // 1. Try resource directory from app handle (bundled app)
        if let Some(app) = app {
            if let Ok(resource_dir) = app.path().resource_dir() {
                possible_paths.push(resource_dir.join(mfa_model_dir).join("model.fst"));
                possible_paths.push(
                    resource_dir.join("resources").join(mfa_model_dir).join("model.fst"),
                );
            }
        }

        // 2. Try current directory (dev mode)
        if let Ok(current_dir) = std::env::current_dir() {
            possible_paths.push(
                current_dir
                    .join("src-tauri")
                    .join("resources")
                    .join(mfa_model_dir)
                    .join("model.fst"),
            );
            possible_paths.push(
                current_dir.join("resources").join(mfa_model_dir).join("model.fst"),
            );
        }

        // 3. Try environment variable
        if let Ok(env_dir) = std::env::var("G2P_MODEL_DIR") {
            if !env_dir.is_empty() {
                let env_buf = PathBuf::from(&env_dir);
                if env_buf.is_file() && env_buf.extension().and_then(|s| s.to_str()) == Some("fst") {
                    possible_paths.push(env_buf);
                } else if env_buf.is_dir() {
                    possible_paths.push(env_buf.join(mfa_model_dir).join("model.fst"));
                }
            }
        }

        // Find the first existing path
        if let Some(path) = possible_paths.iter().find(|p| p.exists() && p.is_file()) {
            Ok(path.clone())
        } else {
            let mut error_msg = format!(
                "G2P model not found for language: {}\nChecked paths:\n",
                language
            );
            for path in &possible_paths {
                error_msg.push_str(&format!("  - {}\n", path.display()));
            }
            Err(AppError::ResourceNotFound(error_msg))
        }
    }
}

