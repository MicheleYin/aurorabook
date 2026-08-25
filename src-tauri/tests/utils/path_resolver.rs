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
fn test_normalize_file_path_decodes_ios_save_urls() {
    let normalized = ResourcePathResolver::normalize_file_path(
        "file:///private/var/mobile/Containers/Shared/AppGroup/abc/File%20Provider%20Storage/A%20novel.mp3",
    );
    assert_eq!(
        normalized,
        "/private/var/mobile/Containers/Shared/AppGroup/abc/File Provider Storage/A novel.mp3"
    );
}

#[test]
fn test_prepare_writable_output_path_creates_parent() {
    let temp_dir = tempfile::tempdir().unwrap();
    let parent = temp_dir.path().join("File Provider Storage").join("dest");
    let encoded = format!(
        "file://{}/A%20novel.mp3",
        parent.to_str().unwrap().replace(' ', "%20")
    );

    let prepared = ResourcePathResolver::prepare_writable_output_path(&encoded).unwrap();
    assert!(prepared.parent().unwrap().exists());
    assert_eq!(
        prepared.file_name().and_then(|s| s.to_str()),
        Some("A novel.mp3")
    );
}
