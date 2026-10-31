//! Tauri commands for continued background conversion.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::epub::cancellation::{get_cancellation_token, CancellationTokens};
use crate::utils::errors::{AppError, AppResult};

use super::jobs::{BackgroundCoordinator, ContinuedConversionStart};
use super::runtime::{query_capabilities, BackgroundCapabilitiesDto};

/// Query platform background-task capabilities.
#[tauri::command]
pub async fn background_capabilities() -> AppResult<BackgroundCapabilitiesDto> {
    Ok(query_capabilities())
}

/// Register an EPUB conversion for app-level progress and cancellation tracking.
#[tauri::command]
pub fn start_continued_conversion(
    book_id: String,
    title: String,
    subtitle: String,
    app: AppHandle,
) -> AppResult<ContinuedConversionStart> {
    if book_id.trim().is_empty() {
        return Err(AppError::Config(
            "book_id is required for continued conversion".into(),
        ));
    }
    let _ = (title, subtitle);

    let cancel_token = get_cancellation_token(&app, &book_id).unwrap_or_else(|_| {
        // Coordinator may run before conversion command creates its token; ensure one exists.
        ensure_cancel_token(&app, &book_id)
    });

    let coordinator = app.state::<BackgroundCoordinator>();
    let start = coordinator.register_job(&book_id, Arc::clone(&cancel_token))?;
    Ok(ContinuedConversionStart {
        continued_processing: false,
        ..start
    })
}

/// Cancel a tracked conversion by task id and flip its conversion cancel token.
#[tauri::command]
pub async fn cancel_continued_task(task_id: String, app: AppHandle) -> AppResult<()> {
    let coordinator = app.state::<BackgroundCoordinator>();
    coordinator.request_cancel_task_id(&task_id)?;

    if let Some((_job_id, book_id)) = coordinator.job_id_for_task(&task_id) {
        if let Some(token) = coordinator.cancel_token_for_book(&book_id) {
            token.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        // Also flip the conversion cancel-token map entry if present.
        if let Some(tokens) = app.try_state::<CancellationTokens>() {
            if let Ok(map) = tokens.get().lock() {
                if let Some(token) = map.get(&book_id) {
                    token.store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }
        }

        coordinator.complete_job(&book_id, false, &app);
    }

    Ok(())
}

fn ensure_cancel_token(app: &AppHandle, book_id: &str) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    if let Some(tokens) = app.try_state::<CancellationTokens>() {
        if let Ok(mut map) = tokens.get().lock() {
            map.insert(book_id.to_string(), Arc::clone(&token));
        }
    }
    token
}
