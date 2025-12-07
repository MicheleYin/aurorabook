//! Tests for epub::converter module
//!
//! Tests cover:
//! - Conversion logic
//! - Chunking and processing
//! - EPUB building
//! - SMIL generation
//! - Progress tracking

pub mod chunking;
pub mod smil;
pub mod progress;
pub mod conversion;
pub mod opf;
#[cfg(test)]
mod opf_resume_test;
