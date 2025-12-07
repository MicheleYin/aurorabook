//! Tests for utils::errors module
//!
//! Tests error handling:
//! - AppError variants
//! - Error context
//! - Error conversion

use aurorabook_lib::utils::errors::{AppError, AppResult};
use std::io;

#[test]
fn test_app_error_io() {
    let io_error = io::Error::new(io::ErrorKind::NotFound, "File not found");
    let app_error = AppError::Io(io_error);
    
    assert!(app_error.to_string().contains("IO error"));
}

#[test]
fn test_app_error_epub_parse() {
    let error = AppError::EpubParse("Invalid EPUB format".to_string());
    assert!(error.to_string().contains("EPUB parsing error"));
    assert!(error.to_string().contains("Invalid EPUB format"));
}

#[test]
fn test_app_error_tts_generation() {
    let error = AppError::TtsGeneration("Engine failed".to_string());
    assert!(error.to_string().contains("TTS generation failed"));
}

#[test]
fn test_app_error_resource_not_found() {
    let error = AppError::ResourceNotFound("Model file missing".to_string());
    assert!(error.to_string().contains("Resource not found"));
}

#[test]
fn test_app_error_invalid_path() {
    let error = AppError::InvalidPath("Path contains ..".to_string());
    assert!(error.to_string().contains("Invalid path"));
}

#[test]
fn test_app_error_file_too_large() {
    let error = AppError::FileTooLarge(1000, 500);
    assert!(error.to_string().contains("File too large"));
    assert!(error.to_string().contains("1000"));
    assert!(error.to_string().contains("500"));
}

#[test]
fn test_app_error_too_many_chapters() {
    let error = AppError::TooManyChapters(100, 50);
    assert!(error.to_string().contains("Too many chapters"));
    assert!(error.to_string().contains("100"));
    assert!(error.to_string().contains("50"));
}

#[test]
fn test_app_error_with_context() {
    let error = AppError::EpubParse("Invalid XML".to_string());
    let error_with_context = error.with_context("Failed to parse chapter 5");
    
    assert!(error_with_context.to_string().contains("Failed to parse chapter 5"));
    assert!(error_with_context.to_string().contains("Invalid XML"));
}

#[test]
fn test_app_error_with_context_multiple() {
    let error = AppError::EpubParse("Invalid XML".to_string());
    let error1 = error.with_context("Failed to parse chapter 5");
    let error2 = error1.with_context("During EPUB conversion");
    
    assert!(error2.to_string().contains("During EPUB conversion"));
    assert!(error2.to_string().contains("Failed to parse chapter 5"));
    assert!(error2.to_string().contains("Invalid XML"));
}

#[test]
fn test_app_error_io_from_std_io_error() {
    let io_error = io::Error::new(io::ErrorKind::PermissionDenied, "Permission denied");
    let app_error: AppError = io_error.into();
    
    assert!(matches!(app_error, AppError::Io(_)));
}

#[test]
fn test_app_result_type() {
    fn success_function() -> AppResult<String> {
        Ok("success".to_string())
    }
    
    fn error_function() -> AppResult<String> {
        Err(AppError::EpubParse("Error".to_string()))
    }
    
    assert!(success_function().is_ok());
    assert!(error_function().is_err());
}

