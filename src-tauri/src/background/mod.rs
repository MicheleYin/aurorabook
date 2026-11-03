//! App-level job tracking for EPUB conversion progress and cancellation.

pub mod commands;
mod jobs;
mod runtime;

pub use commands::{background_capabilities, cancel_continued_task, start_continued_conversion};
pub use jobs::{BackgroundCoordinator, ContinuedConversionStart, JobProgress};
pub use runtime::BackgroundCapabilitiesDto;
