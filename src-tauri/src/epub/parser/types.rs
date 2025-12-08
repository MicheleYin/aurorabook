/// EPUB metadata extracted from the OPF (Open Packaging Format) file.
///
/// Contains all the metadata about the EPUB book, including title, author,
/// publisher, publication date, and cover image information.
///
/// # Fields
/// * `title` - Book title
/// * `creator` - Author/creator name
/// * `publisher` - Publisher name
/// * `subjects` - List of subject tags/categories
/// * `pubdate` - Publication date
/// * `modified_date` - Last modification date
/// * `cover_id` - ID of the cover image in the manifest
#[derive(Debug, Clone)]
pub struct EpubMetadata {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub publisher: Option<String>,
    pub subjects: Vec<String>,
    pub pubdate: Option<String>,
    pub modified_date: Option<String>,
    pub cover_id: Option<String>,
}

/// Manifest item from the OPF file.
///
/// Represents a file entry in the EPUB manifest, which lists all files
/// included in the EPUB package.
///
/// # Fields
/// * `id` - Unique identifier for the item
/// * `href` - Relative path to the file
/// * `media_type` - MIME type of the file (e.g., "application/xhtml+xml")
/// * `properties` - Optional properties (e.g., "nav", "cover-image")
/// * `media_overlay` - Optional media-overlay ID (for EPUB 3 synchronized narration)
#[derive(Debug, Clone)]
pub struct ManifestItem {
    pub id: String,
    pub href: String,
    pub media_type: Option<String>,
    pub properties: Option<String>,
    pub media_overlay: Option<String>,
}

