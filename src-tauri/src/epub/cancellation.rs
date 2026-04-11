//! Cancellation token management for EPUB conversions
//!
//! This module provides functionality for managing cancellation tokens
//! that allow conversions to be cancelled gracefully.

use tauri::{AppHandle, Manager};
use crate::utils::errors::{AppError, AppResult};
use crate::tts::engine::TtsEnginePool;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

/// Global cancellation token storage for conversions
/// Maps book_id to cancellation token
#[derive(Default)]
pub struct CancellationTokens {
    tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl CancellationTokens {
    pub fn new() -> Self {
        Self {
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    
    pub fn get(&self) -> Arc<Mutex<HashMap<String, Arc<AtomicBool>>>> {
        Arc::clone(&self.tokens)
    }
}

/// Tauri command to cancel an ongoing conversion
#[tauri::command]
pub async fn cancel_conversion_command(
    book_id: String,
    app: AppHandle,
) -> AppResult<()> {
    let tokens = app.state::<CancellationTokens>();
    let tokens_map = tokens.inner().get();
    {
        let tokens_guard = tokens_map.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock cancellation tokens: {}", e))
        })?;
        
        if let Some(cancel_token) = tokens_guard.get(&book_id) {
            cancel_token.store(true, Ordering::Relaxed);
            log::info!("Cancellation requested for conversion: book_id={}", book_id);
        } else {
            log::warn!("No active conversion found for book_id: {}", book_id);
        }
    }

    // Drop cached engines immediately on cancellation request.
    // In-flight tasks keep their own Arc references and can unwind safely.
    if let Err(e) = TtsEnginePool::clear_global() {
        log::warn!(
            "Failed to clear global TTS engine pool on cancellation request: {}",
            e
        );
    }
    
    Ok(())
}

/// Get or create a cancellation token for a conversion
pub fn get_cancellation_token(
    app: &AppHandle,
    book_id: &str,
) -> AppResult<Arc<AtomicBool>> {
    let tokens = app.state::<CancellationTokens>();
    let tokens_map = tokens.inner().get();
    let cancel_token = {
        let mut tokens_guard = tokens_map.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock cancellation tokens: {}", e))
        })?;
        
        // Remove any existing token (cleanup from previous conversion)
        tokens_guard.remove(book_id);
        
        // Create new cancellation token
        Arc::new(AtomicBool::new(false))
    };
    
    // Insert the token (need to lock again)
    {
        let mut tokens_guard = tokens_map.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock cancellation tokens: {}", e))
        })?;
        tokens_guard.insert(book_id.to_string(), Arc::clone(&cancel_token));
    }
    
    Ok(cancel_token)
}

/// Clean up cancellation token after conversion completes
pub fn cleanup_cancellation_token(app: &AppHandle, book_id: &str) {
    // Extract the owned Arc first - it lives independently of the state reference
    let tokens_map_opt = {
        if let Some(tokens_state) = app.try_state::<CancellationTokens>() {
            let cancellation_tokens = tokens_state.inner();
            let arc: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>> = cancellation_tokens.get();
            Some(arc)
        } else {
            None
        }
    };
    
    if let Some(arc) = tokens_map_opt {
        // Lock and remove - the guard will be dropped at the end of the match
        match arc.lock() {
            Ok(mut tokens_guard) => {
                tokens_guard.remove(book_id);
                log::debug!("Cleaned up cancellation token for book_id: {}", book_id);
            }
            Err(_) => {
                log::warn!("Failed to lock cancellation tokens for cleanup");
            }
        }
    }
}

