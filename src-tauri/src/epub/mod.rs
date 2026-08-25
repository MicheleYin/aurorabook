pub mod parser;
pub mod converter;
pub mod cancellation;
pub mod conversion_command;
pub mod book_update;

pub use book_update::order_audio_tracks_by_chapters;

// Re-export specific items to avoid ambiguous glob re-exports
pub use parser::{
    EpubMetadata, ManifestItem,
    find_opf_path, derive_base_path_from_opf,
    extract_metadata_with_epub_crate, parse_opf_content,
    parse_ncx_titles,
    find_cover_image, extract_cover_image_as_data_url,
    extract_audio_tracks_from_manifest, extract_audio_tracks_from_spine, compute_audio_track_durations,
    extract_chapters_from_epub,
    extract_year, derive_title_from_path, generate_audio_track_title,
};
pub use converter::{
    ConversionOptions, ConversionChapter, ConversionProgress,
    ConversionCancelledEvent,
    convert_epub_to_audiobook,
};

// Re-export cancellation functionality
pub use cancellation::{
    CancellationTokens,
    cancel_conversion_command,
    pause_conversions_for_background_command,
};

// Re-export conversion command
pub use conversion_command::convert_epub_to_audiobook_command;
