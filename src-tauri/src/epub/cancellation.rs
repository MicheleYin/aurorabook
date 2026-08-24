//! Cancellation token management for EPUB conversions
//!
//! This module provides functionality for managing cancellation tokens
//! that allow conversions to be cancelled gracefully.

use tauri::{AppHandle, Emitter, Manager};
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
        
        if let Some(token) = tokens_guard.get(&book_id) {
            token.store(true, Ordering::Relaxed);
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

/// Pause all active conversions because the app left the foreground (iOS).
///
/// Invoked from Rust lifecycle handlers and from the frontend (`tauri://suspended` /
/// `visibilitychange`) so pause still works if one path misses the event.
#[tauri::command]
pub async fn pause_conversions_for_background_command(app: AppHandle) -> AppResult<()> {
    pause_conversions_for_background(&app);
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

/// Payload emitted when iOS leaves the foreground and active conversions are paused.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionPausedBackgroundEvent {
    pub book_ids: Vec<String>,
}

/// Pause every in-flight conversion because the app left the foreground (iOS).
///
/// Sets all cancel tokens (same checkpoint-preserving path as a user pause), clears the
/// cached TTS/ONNX pool so WebGPU/Metal sessions are not used after suspend, and notifies
/// the frontend. Progress already written to disk remains resumable.
pub fn pause_conversions_for_background(app: &AppHandle) {
    let paused_book_ids = {
        let Some(tokens_state) = app.try_state::<CancellationTokens>() else {
            return;
        };
        let tokens_map = tokens_state.inner().get();
        let Ok(tokens_guard) = tokens_map.lock() else {
            log::warn!("Failed to lock cancellation tokens while pausing for background");
            return;
        };

        let mut book_ids = Vec::new();
        for (book_id, token) in tokens_guard.iter() {
            if !token.load(Ordering::Relaxed) {
                token.store(true, Ordering::Relaxed);
                book_ids.push(book_id.clone());
                log::info!(
                    "Paused conversion for background: book_id={}",
                    book_id
                );
            }
        }
        book_ids
    };

    if paused_book_ids.is_empty() {
        return;
    }

    if let Err(e) = TtsEnginePool::clear_global() {
        log::warn!(
            "Failed to clear global TTS engine pool after background pause: {}",
            e
        );
    }

    if let Some(coord) = app.try_state::<crate::background::BackgroundCoordinator>() {
        coord.cancel_all_for_background(app);
    }

    let event = ConversionPausedBackgroundEvent {
        book_ids: paused_book_ids.clone(),
    };
    if let Err(e) = app.emit("conversion-paused-background", &event) {
        log::warn!("Failed to emit conversion-paused-background: {}", e);
    } else {
        log::info!(
            "Paused {} conversion(s) because the app left the foreground",
            paused_book_ids.len()
        );
    }
}

