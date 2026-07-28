//! Tests for utils::path_resolver module
//!
//! Tests path resolution functions:
//! - find_model_and_voices
//! - validate_path

use aurorabook_lib::utils::path_resolver::ResourcePathResolver;
use aurorabook_lib::utils::errors::AppError;

#[test]
fn test_validate_path_basic() {
    // Test basic path validation
    // Note: This requires actual file system, so we'll test with temp files
    let temp_dir = tempfile::tempdir().unwrap();
    let test_file = temp_dir.path().join("test.txt");
    std::fs::write(&test_file, "test").unwrap();
    
    let result = ResourcePathResolver::validate_path(
        test_file.to_str().unwrap(),
        Some(temp_dir.path())
    );
    assert!(result.is_ok());
}

#[test]
fn test_validate_path_with_file_prefix() {
    // Test that file:/// prefix is removed (absolute path needs three slashes)
    let temp_dir = tempfile::tempdir().unwrap();
    let test_file = temp_dir.path().join("test.txt");
    std::fs::write(&test_file, "test").unwrap();
    
    let file_url = format!("file://{}", test_file.to_str().unwrap());
    let result = ResourcePathResolver::validate_path(
        &file_url,
        Some(temp_dir.path())
    );
    assert!(
        result.is_ok(),
        "file:// URL should validate; got {:?}",
        result.err()
    );
}

#[test]
fn test_validate_path_nonexistent() {
    // Test that nonexistent paths return error
    let result = ResourcePathResolver::validate_path(
        "/nonexistent/path/file.txt",
        None
    );
    assert!(result.is_err());
}

#[test]
fn test_validate_path_outside_allowed_base() {
    // Test that paths outside allowed base return error
    let temp_dir = tempfile::tempdir().unwrap();
    let other_dir = tempfile::tempdir().unwrap();
    let test_file = other_dir.path().join("test.txt");
    std::fs::write(&test_file, "test").unwrap();
    
    let result = ResourcePathResolver::validate_path(
        test_file.to_str().unwrap(),
        Some(temp_dir.path())
    );
    assert!(result.is_err());
}

#[test]
fn test_find_model_and_voices() {
    // Test finding model and voices files
    // This requires actual model files or mocking
    // For now, we'll test error cases
    let result = ResourcePathResolver::find_model_and_voices(None);
    // Should either find files or return ResourceNotFound error
    assert!(result.is_ok() || matches!(result, Err(AppError::ResourceNotFound(_))));
}
