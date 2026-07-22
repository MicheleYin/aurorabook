pub mod engine;
pub mod supertonic;

// Backward-compatible module path for existing code that references
// `kokoros::tts::koko::*`.
pub mod koko {
    pub use super::supertonic::koko::*;
}

