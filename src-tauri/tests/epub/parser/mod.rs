//! Tests for epub::parser module
//!
//! Tests cover:
//! - OPF file finding and parsing
//! - Metadata extraction
//! - Navigation (NCX) parsing
//! - Cover image finding and extraction
//! - Audio track extraction and duration computation
//! - Chapter extraction
//! - Utility functions

pub mod opf;
pub mod metadata;
pub mod navigation;
pub mod cover;
pub mod audio;
pub mod chapters;
pub mod utils;
pub mod types;

