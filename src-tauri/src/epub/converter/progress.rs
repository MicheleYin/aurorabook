use crate::epub::converter::types::ConversionProgress;
use tauri::{AppHandle, Emitter, Manager};

/// Progress callback type for conversion progress updates
pub type ProgressCallback = Box<dyn Fn(ConversionProgress) + Send + Sync>;

/// Emit progress update to frontend
pub fn emit_progress(app: &AppHandle, progress: ConversionProgress) {
    let _ = app.emit("conversion-progress", &progress);

    // Keep iOS Live Activity / BGContinuedProcessingTask in sync when a job is active.
    if let Some(book_id) = current_converting_book_id(app) {
        let completed = progress.words_processed as u64;
        let total = (progress.total_words as u64).max(1);
        if let Some(coord) = app.try_state::<crate::background::BackgroundCoordinator>() {
            coord.report_progress(&book_id, completed, total, app);
        }
    }
}

fn current_converting_book_id(app: &AppHandle) -> Option<String> {
    use crate::epub::CancellationTokens;
    let tokens = app.try_state::<CancellationTokens>()?;
    let tokens_map = tokens.get();
    let map = tokens_map.lock().ok()?;
    // Prefer a book that also has a continued-processing job.
    if let Some(coord) = app.try_state::<crate::background::BackgroundCoordinator>() {
        for book_id in map.keys() {
            if coord.task_id_for_book(book_id).is_some() {
                return Some(book_id.clone());
            }
        }
    }
    map.keys().next().cloned()
}

/// Get the number of CPU cores for parallel processing.
///
/// Returns the number of available CPU cores, with a minimum of 1.
/// This is used to determine how many parallel TTS tasks can run simultaneously.
///
/// On iOS, this always returns 1 to avoid threading issues and ensure smooth UI performance.
///
/// # Returns
/// The number of CPU cores available for parallel processing (at least 1).
///
/// # Example
/// ```rust
/// let parallelism = get_parallelism();
/// println!("Using {} cores for parallel processing", parallelism);
/// ```
pub fn get_parallelism() -> usize {
    // iOS: single model instance to limit memory (Supertonic ONNX is large).
    #[cfg(target_os = "ios")]
    {
        return 1;
    }

    #[cfg(not(target_os = "ios"))]
    {
        1
    }
}

