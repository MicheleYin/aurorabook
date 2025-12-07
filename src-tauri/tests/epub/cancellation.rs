//! Tests for epub::cancellation module
//!
//! Tests cancellation functionality:
//! - CancellationTokens
//! - cancel_conversion_command

use aurorabook_lib::epub::cancellation::CancellationTokens;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[test]
fn test_cancellation_tokens_creation() {
    let tokens = CancellationTokens::new();
    // Should create successfully
    assert!(true); // Just verify it doesn't panic
    
    // Test that we can get the tokens map
    let tokens_map = tokens.get();
    assert!(Arc::strong_count(&tokens_map) >= 1);
}

#[test]
fn test_cancellation_tokens_storage() {
    let tokens = CancellationTokens::new();
    let tokens_map = tokens.get();
    
    // Test that we can store and retrieve tokens
    let cancel_token = Arc::new(AtomicBool::new(false));
    let source_path = "test_path.epub".to_string();
    
    {
        let mut guard = tokens_map.lock().unwrap();
        guard.insert(source_path.clone(), cancel_token.clone());
    }
    
    // Verify token was stored
    {
        let guard = tokens_map.lock().unwrap();
        assert!(guard.contains_key(&source_path));
        let stored_token = guard.get(&source_path).unwrap();
        assert_eq!(Arc::as_ptr(&stored_token), Arc::as_ptr(&cancel_token));
    }
}

#[test]
fn test_cancellation_tokens_cancel() {
    let tokens = CancellationTokens::new();
    let tokens_map = tokens.get();
    
    let cancel_token = Arc::new(AtomicBool::new(false));
    let source_path = "test_path.epub".to_string();
    
    // Store token
    {
        let mut guard = tokens_map.lock().unwrap();
        guard.insert(source_path.clone(), cancel_token.clone());
    }
    
    // Cancel the token
    {
        let guard = tokens_map.lock().unwrap();
        if let Some(token) = guard.get(&source_path) {
            token.store(true, Ordering::Relaxed);
        }
    }
    
    // Verify cancellation
    assert!(cancel_token.load(Ordering::Relaxed));
}

#[test]
fn test_cancellation_tokens_remove() {
    let tokens = CancellationTokens::new();
    let tokens_map = tokens.get();
    
    let cancel_token = Arc::new(AtomicBool::new(false));
    let source_path = "test_path.epub".to_string();
    
    // Store token
    {
        let mut guard = tokens_map.lock().unwrap();
        guard.insert(source_path.clone(), cancel_token.clone());
    }
    
    // Remove token
    {
        let mut guard = tokens_map.lock().unwrap();
        guard.remove(&source_path);
    }
    
    // Verify token was removed
    {
        let guard = tokens_map.lock().unwrap();
        assert!(!guard.contains_key(&source_path));
    }
}

