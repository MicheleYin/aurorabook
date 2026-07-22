//! iOS continuous background processing for long-running EPUB conversion.
//!
//! On iOS 26+, uses `waterkit-background` (`BGContinuedProcessingTaskRequest`).
//! Other platforms expose the same Tauri commands as no-ops / unsupported.

pub mod commands;
mod jobs;
mod runtime;

pub use commands::{
    background_capabilities, cancel_continued_task, start_continued_conversion,
};
pub use jobs::{BackgroundCoordinator, ContinuedConversionStart, JobProgress};
pub use runtime::{init_background_runtime, BackgroundCapabilitiesDto};
