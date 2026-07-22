//! Conversion job coordinator: maps book/job ids ↔ BG task identifiers and progress.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::utils::errors::{AppError, AppResult};

#[cfg(target_os = "ios")]
use waterkit_background::BackgroundTask;

pub const CONVERT_TASK_PREFIX: &str = "com.micheleyin.aurorabook.convert.";
pub const CONVERT_TASK_PATTERN: &str = "com.micheleyin.aurorabook.convert.*";

/// Result of starting a continued-processing conversion job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuedConversionStart {
    pub job_id: String,
    pub task_id: String,
    pub book_id: String,
    /// False on non-iOS or when continued processing is unavailable (conversion may still run).
    pub continued_processing: bool,
}

/// Progress payload emitted to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub job_id: String,
    pub task_id: String,
    pub book_id: String,
    pub completed: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLifecycleEvent {
    pub job_id: String,
    pub task_id: String,
    pub book_id: String,
    pub success: Option<bool>,
}

struct ConversionJob {
    job_id: String,
    book_id: String,
    task_id: String,
    cancel_token: Arc<AtomicBool>,
    #[cfg(target_os = "ios")]
    bg_task: Option<BackgroundTask>,
    pending_progress: Option<(u64, u64)>,
    finished: bool,
}

/// Process-wide coordinator managed as Tauri state.
pub struct BackgroundCoordinator {
    inner: Mutex<CoordinatorInner>,
}

#[derive(Default)]
struct CoordinatorInner {
    by_task_id: HashMap<String, ConversionJob>,
    task_by_book_id: HashMap<String, String>,
    task_by_job_id: HashMap<String, String>,
}

impl BackgroundCoordinator {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(CoordinatorInner::default()),
        }
    }

    /// Register a new conversion job and return identifiers (before platform submit).
    pub fn register_job(
        &self,
        book_id: &str,
        cancel_token: Arc<AtomicBool>,
    ) -> AppResult<ContinuedConversionStart> {
        let job_id = Uuid::new_v4().to_string();
        let task_id = format!("{CONVERT_TASK_PREFIX}{}", Uuid::new_v4());

        let mut guard = self.inner.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock background coordinator: {e}"))
        })?;

        if let Some(old_task) = guard.task_by_book_id.remove(book_id) {
            log::warn!(
                "Replacing active continued-processing job for book_id={} (old task {})",
                book_id,
                old_task
            );
            Self::drop_job_locked(&mut guard, &old_task);
        }

        let job = ConversionJob {
            job_id: job_id.clone(),
            book_id: book_id.to_string(),
            task_id: task_id.clone(),
            cancel_token,
            #[cfg(target_os = "ios")]
            bg_task: None,
            pending_progress: None,
            finished: false,
        };

        guard.task_by_book_id.insert(book_id.to_string(), task_id.clone());
        guard.task_by_job_id.insert(job_id.clone(), task_id.clone());
        guard.by_task_id.insert(task_id.clone(), job);

        Ok(ContinuedConversionStart {
            job_id,
            task_id,
            book_id: book_id.to_string(),
            continued_processing: cfg!(target_os = "ios"),
        })
    }

    pub fn cancel_token_for_book(&self, book_id: &str) -> Option<Arc<AtomicBool>> {
        let guard = self.inner.lock().ok()?;
        let task_id = guard.task_by_book_id.get(book_id)?;
        guard
            .by_task_id
            .get(task_id)
            .map(|j| Arc::clone(&j.cancel_token))
    }

    /// Keep job cancel token in sync when conversion creates/replaces its token.
    pub fn rebind_cancel_token(&self, book_id: &str, cancel_token: Arc<AtomicBool>) {
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let Some(task_id) = guard.task_by_book_id.get(book_id).cloned() else {
            return;
        };
        if let Some(job) = guard.by_task_id.get_mut(&task_id) {
            job.cancel_token = cancel_token;
        }
    }

    pub fn task_id_for_book(&self, book_id: &str) -> Option<String> {
        let guard = self.inner.lock().ok()?;
        guard.task_by_book_id.get(book_id).cloned()
    }

    pub fn job_id_for_task(&self, task_id: &str) -> Option<(String, String)> {
        let guard = self.inner.lock().ok()?;
        guard
            .by_task_id
            .get(task_id)
            .map(|j| (j.job_id.clone(), j.book_id.clone()))
    }

    /// Attach the platform `BackgroundTask` after `Launched`.
    #[cfg(target_os = "ios")]
    pub fn attach_launched_task(&self, task: BackgroundTask) -> AppResult<()> {
        let task_id = task.identifier().as_str().to_string();
        let mut guard = self.inner.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock background coordinator: {e}"))
        })?;

        let job = guard.by_task_id.get_mut(&task_id).ok_or_else(|| {
            AppError::Store(format!(
                "No conversion job registered for launched task {}",
                task_id
            ))
        })?;

        if let Some((completed, total)) = job.pending_progress.take() {
            if let Err(e) = task.update_progress(completed, total) {
                log::warn!(
                    "Failed to flush pending progress for {}: {}",
                    task_id,
                    e
                );
            }
        }

        job.bg_task = Some(task);
        Ok(())
    }

    /// Mark cancel token when the system expires / user cancels from Live Activity.
    pub fn handle_expiration(&self, task_id: &str, app: &AppHandle) {
        let lifecycle = {
            let mut guard = match self.inner.lock() {
                Ok(g) => g,
                Err(e) => {
                    log::error!("background coordinator poisoned on expiration: {e}");
                    return;
                }
            };

            let Some(job) = guard.by_task_id.get_mut(task_id) else {
                log::warn!("Expiration for unknown task_id={}", task_id);
                return;
            };

            job.cancel_token.store(true, Ordering::Relaxed);
            job.finished = true;

            #[cfg(target_os = "ios")]
            if let Some(task) = job.bg_task.take() {
                if let Err(e) = task.complete(false) {
                    log::warn!("Failed to complete expired background task: {e}");
                }
            }

            let event = JobLifecycleEvent {
                job_id: job.job_id.clone(),
                task_id: job.task_id.clone(),
                book_id: job.book_id.clone(),
                success: Some(false),
            };
            Self::drop_job_locked(&mut guard, task_id);
            event
        };

        let _ = app.emit("background-task-expired", &lifecycle);
    }

    /// Forward conversion progress to the Live Activity / system UI.
    pub fn report_progress(
        &self,
        book_id: &str,
        completed: u64,
        total: u64,
        app: &AppHandle,
    ) {
        let total = total.max(1);
        let completed = completed.min(total);

        let payload = {
            let mut guard = match self.inner.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let Some(task_id) = guard.task_by_book_id.get(book_id).cloned() else {
                return;
            };
            let Some(job) = guard.by_task_id.get_mut(&task_id) else {
                return;
            };
            if job.finished {
                return;
            }

            #[cfg(target_os = "ios")]
            if let Some(ref task) = job.bg_task {
                if let Err(e) = task.update_progress(completed, total) {
                    log::debug!("update_progress failed for {}: {}", task_id, e);
                }
            } else {
                job.pending_progress = Some((completed, total));
            }

            #[cfg(not(target_os = "ios"))]
            {
                job.pending_progress = Some((completed, total));
            }

            JobProgress {
                job_id: job.job_id.clone(),
                task_id: job.task_id.clone(),
                book_id: job.book_id.clone(),
                completed,
                total,
            }
        };

        let _ = app.emit("background-task-progress", &payload);
    }

    /// Finish the job (success or failure). Always completes the BG task when present.
    pub fn complete_job(&self, book_id: &str, success: bool, app: &AppHandle) {
        let lifecycle = {
            let mut guard = match self.inner.lock() {
                Ok(g) => g,
                Err(e) => {
                    log::error!("background coordinator poisoned on complete: {e}");
                    return;
                }
            };

            let Some(task_id) = guard.task_by_book_id.get(book_id).cloned() else {
                return;
            };
            let Some(job) = guard.by_task_id.get_mut(&task_id) else {
                return;
            };
            if job.finished {
                Self::drop_job_locked(&mut guard, &task_id);
                return;
            }
            job.finished = true;

            #[cfg(target_os = "ios")]
            if let Some(task) = job.bg_task.take() {
                if let Err(e) = task.complete(success) {
                    log::warn!("Failed to complete background task {}: {}", task_id, e);
                }
            }

            let event = JobLifecycleEvent {
                job_id: job.job_id.clone(),
                task_id: job.task_id.clone(),
                book_id: job.book_id.clone(),
                success: Some(success),
            };
            Self::drop_job_locked(&mut guard, &task_id);
            event
        };

        let _ = app.emit("background-task-completed", &lifecycle);
    }

    /// Request cancel of the platform task (Live Activity / scheduler).
    pub fn request_cancel_task_id(&self, task_id: &str) -> AppResult<()> {
        let mut guard = self.inner.lock().map_err(|e| {
            AppError::Store(format!("Failed to lock background coordinator: {e}"))
        })?;

        if let Some(job) = guard.by_task_id.get_mut(task_id) {
            job.cancel_token.store(true, Ordering::Relaxed);
        }

        Ok(())
    }

    fn drop_job_locked(guard: &mut CoordinatorInner, task_id: &str) {
        if let Some(job) = guard.by_task_id.remove(task_id) {
            guard.task_by_book_id.remove(&job.book_id);
            guard.task_by_job_id.remove(&job.job_id);
        }
    }
}

impl Default for BackgroundCoordinator {
    fn default() -> Self {
        Self::new()
    }
}
