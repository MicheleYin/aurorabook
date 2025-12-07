use crate::epub::converter::types::ConversionProgress;
use tauri::{AppHandle, Emitter};

/// Progress callback type for conversion progress updates
pub type ProgressCallback = Box<dyn Fn(ConversionProgress) + Send + Sync>;

/// Emit progress update to frontend
pub fn emit_progress(app: &AppHandle, progress: ConversionProgress) {
    let _ = app.emit("conversion-progress", progress);
}

/// Get the number of CPU cores for parallel processing.
///
/// Returns the number of available CPU cores, with a minimum of 1.
/// This is used to determine how many parallel TTS tasks can run simultaneously.
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
    use num_cpus;
    let logical = num_cpus::get();

    // Reserve at least one core for the OS / UI thread / real-time tasks.
    let mut workers = logical.saturating_sub(1);

    // If the machine has many cores, avoid taking *all* of them.
    // Example: 32-core machines → use 24 cores.
    if logical >= 8 {
        workers = workers.min((logical as f64 * 0.50).round() as usize);
    }

    workers.max(1)
}

