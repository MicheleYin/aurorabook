use thiserror::Error;
use tauri::ipc::InvokeError;

/// Application error types for structured error handling.
///
/// This enum provides type-safe error handling throughout the application,
/// replacing string-based errors with specific error variants. Each variant
/// can carry context information to help with debugging.
///
/// # Variants
/// * `Io` - I/O errors (file operations, network, etc.)
/// * `EpubParse` - EPUB parsing and processing errors
/// * `TtsGeneration` - Text-to-speech generation failures
/// * `ResourceNotFound` - Missing model files, resources, etc.
/// * `InvalidPath` - Path validation errors
/// * `FileTooLarge` - File size limit exceeded
/// * `TooManyChapters` - Chapter count limit exceeded
/// * `Encoding` - Audio/text encoding errors
/// * `ZipArchive` - ZIP/EPUB archive errors
/// * `XmlParse` - XML parsing errors (OPF, SMIL, etc.)
/// * `Store` - Persistent storage errors
/// * `Config` - Configuration errors
/// * `DuplicateBook` - Duplicate book detection errors
///
/// # Example
/// ```rust
/// use crate::utils::errors::{AppError, AppResult};
///
/// fn process_file(path: &str) -> AppResult<Vec<u8>> {
///     std::fs::read(path)
///         .map_err(|e| AppError::Io(e))
/// }
/// ```
#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("EPUB parsing error: {0}")]
    EpubParse(String),

    #[error("TTS generation failed: {0}")]
    TtsGeneration(String),

    #[error("Resource not found: {0}")]
    ResourceNotFound(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("File too large: {0} bytes (max: {1} bytes)")]
    FileTooLarge(usize, usize),

    #[error("Too many chapters: {0} (max: {1})")]
    TooManyChapters(usize, usize),

    #[error("Encoding error: {0}")]
    Encoding(String),

    #[error("ZIP archive error: {0}")]
    ZipArchive(String),

    #[error("XML parsing error: {0}")]
    XmlParse(String),

    #[error("Store error: {0}")]
    Store(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Duplicate book: {0}")]
    DuplicateBook(String),
}

/// Result type alias for application errors.
///
/// This is a convenience type alias that should be used instead of
/// `Result<T, String>` throughout the application for consistent
/// error handling.
///
/// # Example
/// ```rust
/// use crate::utils::errors::AppResult;
///
/// fn my_function() -> AppResult<String> {
///     Ok("success".to_string())
/// }
/// ```
pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    /// Add context to an error message.
    ///
    /// This method prepends additional context information to the error
    /// message, making it easier to trace where errors occurred.
    ///
    /// # Arguments
    /// * `context` - Context string to prepend to the error message
    ///
    /// # Returns
    /// A new `AppError` with the context prepended to the message.
    ///
    /// # Example
    /// ```rust
    /// let error = AppError::EpubParse("Invalid XML".to_string());
    /// let error_with_context = error.with_context("Failed to parse chapter 5");
    /// // Error message: "Failed to parse chapter 5: Invalid XML"
    /// ```
    pub fn with_context(self, context: impl Into<String>) -> Self {
        match self {
            AppError::EpubParse(msg) => AppError::EpubParse(format!("{}: {}", context.into(), msg)),
            AppError::TtsGeneration(msg) => AppError::TtsGeneration(format!("{}: {}", context.into(), msg)),
            AppError::ResourceNotFound(msg) => AppError::ResourceNotFound(format!("{}: {}", context.into(), msg)),
            AppError::InvalidPath(msg) => AppError::InvalidPath(format!("{}: {}", context.into(), msg)),
            AppError::Encoding(msg) => AppError::Encoding(format!("{}: {}", context.into(), msg)),
            AppError::ZipArchive(msg) => AppError::ZipArchive(format!("{}: {}", context.into(), msg)),
            AppError::XmlParse(msg) => AppError::XmlParse(format!("{}: {}", context.into(), msg)),
            AppError::Store(msg) => AppError::Store(format!("{}: {}", context.into(), msg)),
            AppError::Config(msg) => AppError::Config(format!("{}: {}", context.into(), msg)),
            AppError::DuplicateBook(msg) => AppError::DuplicateBook(format!("{}: {}", context.into(), msg)),
            other => other,
        }
    }
}

/// Implement conversion to Tauri's InvokeError for use in Tauri commands.
///
/// This allows AppError to be used directly as the error type in Tauri command
/// return values, automatically converting to InvokeError for serialization.
impl Into<InvokeError> for AppError {
    fn into(self) -> InvokeError {
        InvokeError::from(self.to_string())
    }
}

