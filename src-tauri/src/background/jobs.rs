//! Conversion job coordinator for app-level progress and cancellation.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::utils::errors::{AppError, AppResult};

pub const CONVERT_TASK_PREFIX: &str = "com.micheleyin.aurorabook.convert.";

/// Result of starting a tracked conversion job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuedConversionStart {
    pub job_id: String,
    pub task_id: String,
    pub book_id: String,
    /// Retained for API compatibility; system continued processing is disabled.
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
    pub percent: u8,
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
            finished: false,
        };

        guard.task_by_book_id.insert(book_id.to_string(), task_id.clone());
        guard.task_by_job_id.insert(job_id.clone(), task_id.clone());
        guard.by_task_id.insert(task_id.clone(), job);

        Ok(ContinuedConversionStart {
            job_id,
            task_id,
            book_id: book_id.to_string(),
            continued_processing: false,
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

    /// Mark the cancel token when a tracked job expires.
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

    /// Emit conversion progress for a tracked job.
    pub fn report_progress(
        &self,
        book_id: &str,
        completed: u64,
        total: u64,
        app: &AppHandle,
    ) {
        let total = total.max(1);
        let completed = completed.min(total);
        let percent = progress_percent(completed, total);

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

            JobProgress {
                job_id: job.job_id.clone(),
                task_id: job.task_id.clone(),
                book_id: job.book_id.clone(),
                completed,
                total,
                percent,
            }
        };

        let _ = app.emit("background-task-progress", &payload);
    }

    /// Finish the tracked job (success or failure).
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

    /// Request cancellation of a tracked conversion.
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

fn progress_percent(completed: u64, total: u64) -> u8 {
    let total = total.max(1);
    let completed = completed.min(total);
    ((completed as f64 / total as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_percent_handles_edges() {
        assert_eq!(progress_percent(0, 0), 0);
        assert_eq!(progress_percent(0, 10), 0);
        assert_eq!(progress_percent(5, 10), 50);
        assert_eq!(progress_percent(10, 10), 100);
        assert_eq!(progress_percent(99, 10), 100); // clamps completed
        assert_eq!(progress_percent(1, 3), 33);
    }

    #[test]
    fn continued_conversion_start_serializes_camel_case() {
        let payload = ContinuedConversionStart {
            job_id: "j1".into(),
            task_id: "t1".into(),
            book_id: "b1".into(),
            continued_processing: false,
        };
        let json = serde_json::to_value(&payload).expect("serialize");
        assert_eq!(json["jobId"], "j1");
        assert_eq!(json["taskId"], "t1");
        assert_eq!(json["bookId"], "b1");
        assert_eq!(json["continuedProcessing"], true);
    }

    #[test]
    fn conversion_job_coordinator_tracks_cancel_tokens() {
        let coordinator = BackgroundCoordinator::new();
        let token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let started = coordinator
            .register_job("book-1", token.clone())
            .expect("register job");
        assert_eq!(started.book_id, "book-1");
        assert!(started.task_id.starts_with(CONVERT_TASK_PREFIX));
        assert!(coordinator.cancel_token_for_book("book-1").is_some());
        assert_eq!(
            coordinator.task_id_for_book("book-1").as_deref(),
            Some(started.task_id.as_str())
        );
        assert_eq!(
            coordinator.job_id_for_task(&started.task_id),
            Some((started.job_id.clone(), "book-1".into()))
        );

        let rebound = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        coordinator.rebind_cancel_token("book-1", rebound.clone());
        let stored = coordinator.cancel_token_for_book("book-1").unwrap();
        assert!(stored.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn register_job_replaces_prior_job() {
        let coordinator = BackgroundCoordinator::new();
        let first_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let first = coordinator
            .register_job("book-2", first_token.clone())
            .expect("register first");
        assert_eq!(first.book_id, "book-2");

        let second_token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let second = coordinator
            .register_job("book-2", second_token.clone())
            .expect("register replacement");
        assert_ne!(first.task_id, second.task_id);
        assert_eq!(
            coordinator.task_id_for_book("book-2").as_deref(),
            Some(second.task_id.as_str())
        );
        assert!(coordinator.job_id_for_task(&first.task_id).is_none());
        assert_eq!(
            coordinator.job_id_for_task(&second.task_id),
            Some((second.job_id.clone(), "book-2".into()))
        );
    }

    #[test]
    fn request_cancel_sets_token_and_unknown_is_noop() {
        let coordinator = BackgroundCoordinator::new();
        let token = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let started = coordinator
            .register_job("book-3", token.clone(), "Cancel me")
            .expect("register");

        coordinator
            .request_cancel_task_id(&started.task_id)
            .expect("cancel");
        assert!(token.load(std::sync::atomic::Ordering::Relaxed));

        coordinator
            .request_cancel_task_id("missing-task")
            .expect("unknown cancel is ok");
        assert!(coordinator.cancel_token_for_book("missing").is_none());
        coordinator.rebind_cancel_token("missing", token);
    }

    #[test]
    fn job_progress_serializes_camel_case() {
        let payload = JobProgress {
            job_id: "j".into(),
            task_id: "t".into(),
            book_id: "b".into(),
            completed: 3,
            total: 10,
            percent: 30,
        };
        let json = serde_json::to_value(&payload).expect("serialize");
        assert_eq!(json["jobId"], "j");
        assert_eq!(json["completed"], 3);
        assert_eq!(json["percent"], 30);
    }
}
