//! Tauri commands for continued background conversion.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::epub::cancellation::{get_cancellation_token, CancellationTokens};
use crate::utils::errors::{AppError, AppResult};

use super::jobs::{BackgroundCoordinator, ContinuedConversionStart};
use super::runtime::{query_capabilities, BackgroundCapabilitiesDto};

#[cfg(target_os = "ios")]
use super::runtime::ios_runtime;

/// Query platform background-task capabilities.
#[tauri::command]
pub async fn background_capabilities() -> AppResult<BackgroundCapabilitiesDto> {
    Ok(query_capabilities())
}

/// Submit an iOS 26+ `BGContinuedProcessingTaskRequest` for EPUB conversion.
///
/// Must be invoked from a user gesture before heavy TTS/model work. Kept
/// synchronous so submit reaches the main-queue Swift bridge quickly while the
/// app is still foregrounded (important for iPhone Live Activity UI).
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
    let title = if title.trim().is_empty() {
        "Converting audiobook".to_string()
    } else {
        title
    };
    let subtitle = if subtitle.trim().is_empty() {
        "AuroraBook".to_string()
    } else {
        subtitle
    };

    let cancel_token = get_cancellation_token(&app, &book_id).unwrap_or_else(|_| {
        // Coordinator may run before conversion command creates its token; ensure one exists.
        ensure_cancel_token(&app, &book_id)
    });

    let coordinator = app.state::<BackgroundCoordinator>();
    let start = coordinator.register_job(&book_id, Arc::clone(&cancel_token), &title)?;

    #[cfg(target_os = "ios")]
    {
        let caps = query_capabilities();
        if !caps.supports_continued_processing {
            log::warn!(
                "Continued processing not supported on this device/OS; job {} registered without BG task",
                start.job_id
            );
            return Ok(ContinuedConversionStart {
                continued_processing: false,
                ..start
            });
        }

        let runtime = ios_runtime(&app).ok_or_else(|| {
            AppError::TtsGeneration(
                "iOS background runtime is not initialized".into(),
            )
        })?;

        use waterkit_background::{
            ContinuedProcessingRequest, ContinuedProcessingStrategy, TaskIdentifier,
        };

        let identifier = TaskIdentifier::new(start.task_id.clone()).map_err(|e| {
            AppError::Config(format!("invalid task identifier: {e}"))
        })?;

        let request = ContinuedProcessingRequest::new(identifier, title, subtitle)
            .map_err(|e| AppError::TtsGeneration(format!("invalid continued request: {e}")))?
            .strategy(ContinuedProcessingStrategy::Queue)
            .requires_gpu(false);

        runtime
            .submit_continued_processing(request)
            .map_err(|e| {
                AppError::TtsGeneration(format!(
                    "Failed to submit BGContinuedProcessingTaskRequest: {e}"
                ))
            })?;

        log::info!(
            "Submitted continued conversion task {} for book {}",
            start.task_id,
            book_id
        );
        return Ok(start);
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = (title, subtitle);
        Ok(ContinuedConversionStart {
            continued_processing: false,
            ..start
        })
    }
}

/// Cancel a continued-processing task by platform task id (and flip conversion cancel token).
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

        #[cfg(target_os = "ios")]
        {
            if let Some(runtime) = ios_runtime(&app) {
                use waterkit_background::TaskIdentifier;
                if let Ok(id) = TaskIdentifier::new(task_id.clone()) {
                    if let Err(e) = runtime.cancel(&id) {
                        log::warn!("Failed to cancel BG task {}: {}", task_id, e);
                    }
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
