//! Tests for epub module
//!
//! Tests cover:
//! - Parser modules (opf, metadata, navigation, cover, audio, chapters, utils)
//! - Converter modules (conversion, chunking, extraction, processing, epub_builder, progress, opf, smil, audio)
//! - Book update functionality
//! - Cancellation functionality
//! - Conversion commands

pub mod parser;
#[path = "converter/mod.rs"]
pub mod converter;
pub mod book_update;
pub mod cancellation;
pub mod conversion_command;

