//! Platform background runtime bootstrap and event loop.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::jobs::{BackgroundCoordinator, CONVERT_TASK_PATTERN};

/// Serializable capability flags for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundCapabilitiesDto {
    pub supports_app_refresh: bool,
    pub supports_processing: bool,
    pub supports_continued_processing: bool,
    pub supports_continued_processing_gpu: bool,
    pub supports_launch_events: bool,
    pub is_ios: bool,
}

impl BackgroundCapabilitiesDto {
    pub fn unsupported() -> Self {
        Self {
            supports_app_refresh: false,
            supports_processing: false,
            supports_continued_processing: false,
            supports_continued_processing_gpu: false,
            supports_launch_events: false,
            is_ios: cfg!(target_os = "ios"),
        }
    }
}

/// Initialize the platform background scheduler (iOS) and start the event loop.
pub fn init_background_runtime(app: &AppHandle) {
    #[cfg(target_os = "ios")]
    {
        if let Err(e) = init_ios_runtime(app) {
            log::error!("Failed to initialize iOS background runtime: {e}");
        }
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        log::debug!("Background continued-processing runtime skipped (non-iOS)");
    }
}

pub fn query_capabilities() -> BackgroundCapabilitiesDto {
    #[cfg(target_os = "ios")]
    {
        let caps = waterkit_background::capabilities();
        BackgroundCapabilitiesDto {
            supports_app_refresh: caps.supports_app_refresh,
            supports_processing: caps.supports_processing,
            supports_continued_processing: caps.supports_continued_processing,
            supports_continued_processing_gpu: caps.supports_continued_processing_gpu,
            supports_launch_events: caps.supports_launch_events,
            is_ios: true,
        }
    }

    #[cfg(not(target_os = "ios"))]
    {
        BackgroundCapabilitiesDto::unsupported()
    }
}

#[cfg(target_os = "ios")]
fn init_ios_runtime(app: &AppHandle) -> Result<(), String> {
    use waterkit_background::{
        BootstrapConfig, ContinuedTaskPattern, BackgroundEvent,
    };

    let pattern = ContinuedTaskPattern::new(CONVERT_TASK_PATTERN)
        .map_err(|e| format!("invalid continued pattern: {e}"))?;

    let config = BootstrapConfig::new()
        .register_continued_processing(pattern)
        .map_err(|e| format!("register continued processing failed: {e}"))?;

    let runtime = waterkit_background::initialize(config)
        .map_err(|e| format!("waterkit initialize failed: {e}"))?;

    let rx = runtime.subscribe();
    let app_handle = app.clone();

    // Keep runtime alive for process lifetime (scheduler + Swift bridge handles).
    let runtime = std::sync::Arc::new(runtime);
    app.manage(IosBackgroundRuntime(std::sync::Arc::clone(&runtime)));

    tauri::async_runtime::spawn(async move {
        log::info!("iOS background event loop started");
        while let Ok(event) = rx.recv().await {
            match event {
                BackgroundEvent::Launched(task) => {
                    let task_id = task.identifier().as_str().to_string();
                    log::info!("Background task launched: {}", task_id);
                    if let Some(coord) = app_handle.try_state::<BackgroundCoordinator>() {
                        if let Err(e) = coord.attach_launched_task(task) {
                            log::error!("Failed to attach launched background task: {e}");
                        }
                    }
                }
                BackgroundEvent::Expired(expiration) => {
                    let task_id = expiration.identifier().as_str().to_string();
                    log::warn!("Background task expired: {}", task_id);
                    if let Some(coord) = app_handle.try_state::<BackgroundCoordinator>() {
                        coord.handle_expiration(&task_id, &app_handle);
                    }
                    // Also flip conversion cancel token store if present.
                    if let Some(coord) = app_handle.try_state::<BackgroundCoordinator>() {
                        if let Some(( _job_id, book_id)) = coord.job_id_for_task(&task_id) {
                            if let Some(tokens) =
                                app_handle.try_state::<crate::epub::CancellationTokens>()
                            {
                                if let Ok(map) = tokens.get().lock() {
                                    if let Some(token) = map.get(&book_id) {
                                        token.store(
                                            true,
                                            std::sync::atomic::Ordering::Relaxed,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        log::warn!("iOS background event loop ended");
    });

    log::info!(
        "iOS background runtime initialized (pattern={})",
        CONVERT_TASK_PATTERN
    );
    Ok(())
}

/// Held in Tauri state so the Swift/runtime handle is not dropped.
#[cfg(target_os = "ios")]
pub struct IosBackgroundRuntime(pub std::sync::Arc<waterkit_background::BackgroundRuntime>);

#[cfg(target_os = "ios")]
pub fn ios_runtime(app: &AppHandle) -> Option<std::sync::Arc<waterkit_background::BackgroundRuntime>> {
    app.try_state::<IosBackgroundRuntime>()
        .map(|s| std::sync::Arc::clone(&s.0))
}

#[cfg(test)]
mod tests {
    use super::{query_capabilities, BackgroundCapabilitiesDto};

    #[test]
    fn unsupported_capabilities_disable_everything() {
        let caps = BackgroundCapabilitiesDto::unsupported();

        assert!(!caps.supports_app_refresh);
        assert!(!caps.supports_processing);
        assert!(!caps.supports_continued_processing);
        assert!(!caps.supports_continued_processing_gpu);
        assert!(!caps.supports_launch_events);
        assert_eq!(caps.is_ios, cfg!(target_os = "ios"));
    }

    #[test]
    fn query_capabilities_matches_platform_shape() {
        let caps = query_capabilities();

        #[cfg(not(target_os = "ios"))]
        {
            assert!(!caps.supports_app_refresh);
            assert!(!caps.supports_processing);
            assert!(!caps.supports_continued_processing);
            assert!(!caps.supports_continued_processing_gpu);
            assert!(!caps.supports_launch_events);
            assert!(!caps.is_ios);
        }

        #[cfg(target_os = "ios")]
        {
            assert!(caps.is_ios);
        }
    }
}
