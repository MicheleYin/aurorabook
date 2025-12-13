//! EPUB parser module
//!
//! This module provides functionality for parsing EPUB files and extracting
//! metadata, chapters, navigation, cover images, and audio tracks.
//!
//! The module is organized into sub-modules:
//! - `types` - Core data structures (EpubMetadata, ManifestItem)
//! - `opf` - OPF file path finding and parsing
//! - `metadata` - Metadata extraction from OPF files
//! - `navigation` - Navigation document and NCX parsing
//! - `cover` - Cover image finding and extraction
//! - `audio` - Audio track extraction and duration computation
//! - `chapters` - Chapter extraction from EPUB spine
//! - `utils` - Utility functions

pub mod types;
pub mod opf;
pub mod metadata;
pub mod navigation;
pub mod cover;
pub mod audio;
pub mod chapters;
pub mod utils;

// Re-export types
pub use types::{EpubMetadata, ManifestItem};

// Re-export OPF functions
pub use opf::{find_opf_path, derive_base_path_from_opf};

// Re-export metadata functions
pub use metadata::{extract_metadata_with_epub_crate, parse_opf_content};

// Re-export navigation functions
pub use navigation::{parse_ncx_titles, parse_ncx_ordered_hrefs};

// Re-export cover functions
pub use cover::{find_cover_image, extract_cover_image_as_data_url};

// Re-export audio functions
pub use audio::{extract_audio_tracks_from_manifest, extract_audio_tracks_from_spine, compute_audio_track_durations};

// Re-export chapter functions
pub use chapters::extract_chapters_from_epub;

// Re-export utility functions
pub use utils::{extract_year, derive_title_from_path, generate_audio_track_title};

