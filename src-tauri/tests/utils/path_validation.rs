//! Tests for utils::path_validation module
//!
//! Tests path validation functions:
//! - validate_epub_path
//! - validate_file_size
//! - validate_chapter_count

use aurorabook_lib::utils::path_validation;
use aurorabook_lib::utils::errors::AppError;

#[test]
fn test_validate_epub_path_valid() {
    assert!(path_validation::validate_epub_path("chapter1.xhtml").is_ok());
    assert!(path_validation::validate_epub_path("OEBPS/chapter1.xhtml").is_ok());
    assert!(path_validation::validate_epub_path("EPUB/chapter1.xhtml").is_ok());
}

#[test]
fn test_validate_epub_path_removes_leading_slash() {
    let result = path_validation::validate_epub_path("/chapter1.xhtml");
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "chapter1.xhtml");
}

#[test]
fn test_validate_epub_path_rejects_traversal() {
    assert!(path_validation::validate_epub_path("../etc/passwd").is_err());
    assert!(path_validation::validate_epub_path("../../etc/passwd").is_err());
    assert!(path_validation::validate_epub_path("chapter/../../etc/passwd").is_err());
}

#[test]
fn test_validate_epub_path_rejects_absolute() {
    // Note: This depends on the platform
    #[cfg(unix)]
    {
        assert!(path_validation::validate_epub_path("/absolute/path").is_err());
    }
}

#[test]
fn test_validate_epub_path_rejects_null_bytes() {
    let path_with_null = "chapter1\0.xhtml";
    assert!(path_validation::validate_epub_path(path_with_null).is_err());
}

#[test]
fn test_validate_file_size_within_limit() {
    assert!(path_validation::validate_file_size(1000, 5000, "test").is_ok());
    assert!(path_validation::validate_file_size(5000, 5000, "test").is_ok());
}

#[test]
fn test_validate_file_size_exceeds_limit() {
    let result = path_validation::validate_file_size(6000, 5000, "test");
    assert!(result.is_err());
    
    if let Err(AppError::FileTooLarge(size, max)) = result {
        assert_eq!(size, 6000);
        assert_eq!(max, 5000);
    } else {
        panic!("Expected FileTooLarge error");
    }
}

#[test]
fn test_validate_chapter_count_within_limit() {
    assert!(path_validation::validate_chapter_count(10, 100).is_ok());
    assert!(path_validation::validate_chapter_count(100, 100).is_ok());
}

#[test]
fn test_validate_chapter_count_exceeds_limit() {
    let result = path_validation::validate_chapter_count(150, 100);
    assert!(result.is_err());
    
    if let Err(AppError::TooManyChapters(count, max)) = result {
        assert_eq!(count, 150);
        assert_eq!(max, 100);
    } else {
        panic!("Expected TooManyChapters error");
    }
}

#[test]
fn test_validate_epub_path_edge_cases() {
    // Empty string
    assert!(path_validation::validate_epub_path("").is_ok());
    
    // Just a slash
    let result = path_validation::validate_epub_path("/");
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "");
    
    // Path with spaces
    assert!(path_validation::validate_epub_path("chapter 1.xhtml").is_ok());
    
    // Path with special characters (but not ..)
    assert!(path_validation::validate_epub_path("chapter-1.xhtml").is_ok());
    assert!(path_validation::validate_epub_path("chapter_1.xhtml").is_ok());
}

