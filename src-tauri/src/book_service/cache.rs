use std::sync::Arc;
use std::time::Duration;
use moka::future::Cache;
use crate::book_service::models::{Book, Chapter, AudioTrack};

/// Cache for books by ID
pub type BookCache = Cache<String, Arc<Book>>;

/// Cache for chapters by (book_id, chapter_id)
pub type ChapterCache = Cache<(String, String), Arc<Chapter>>;

/// Cache for chapters list by book_id
pub type ChaptersListCache = Cache<String, Arc<Vec<Chapter>>>;

/// Cache for audio tracks list by book_id
pub type AudioTracksListCache = Cache<String, Arc<Vec<AudioTrack>>>;

/// Cache for images by (book_id, href) -> (mime_type, data)
pub type ImageCache = Cache<(String, String), Arc<(String, Vec<u8>)>>;

/// Cache for audio data by (book_id, href) -> data
pub type AudioDataCache = Cache<(String, String), Arc<Vec<u8>>>;

/// Database cache manager
/// Provides caching for frequently accessed database queries to reduce disk I/O
pub struct DbCache {
    /// Cache for complete books (includes chapters and audio tracks)
    pub books: BookCache,
    /// Cache for individual chapters
    pub chapters: ChapterCache,
    /// Cache for chapter lists per book
    pub chapters_list: ChaptersListCache,
    /// Cache for audio track lists per book
    pub audio_tracks_list: AudioTracksListCache,
    /// Cache for images
    pub images: ImageCache,
    /// Cache for audio data
    pub audio_data: AudioDataCache,
}

impl DbCache {
    /// Create a new cache manager with default TTL settings
    pub fn new() -> Self {
        // Books cache: 5 minutes TTL, max 100 entries
        let books = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(300))
            .build();

        // Chapters cache: 10 minutes TTL, max 1000 entries
        let chapters = Cache::builder()
            .max_capacity(1000)
            .time_to_live(Duration::from_secs(600))
            .build();

        // Chapters list cache: 5 minutes TTL, max 100 entries
        let chapters_list = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(300))
            .build();

        // Audio tracks list cache: 5 minutes TTL, max 100 entries
        let audio_tracks_list = Cache::builder()
            .max_capacity(100)
            .time_to_live(Duration::from_secs(300))
            .build();

        // Images cache: 30 minutes TTL, max 500 entries (images are large, cache longer)
        let images = Cache::builder()
            .max_capacity(500)
            .time_to_live(Duration::from_secs(1800))
            .build();

        // Audio data cache: 30 minutes TTL, max 200 entries (audio files are large)
        let audio_data = Cache::builder()
            .max_capacity(200)
            .time_to_live(Duration::from_secs(1800))
            .build();

        Self {
            books,
            chapters,
            chapters_list,
            audio_tracks_list,
            images,
            audio_data,
        }
    }

    /// Invalidate all caches for a book
    pub async fn invalidate_book(&self, book_id: &str) {
        // Invalidate book
        self.books.invalidate(book_id).await;
        
        // Invalidate chapters list
        self.chapters_list.invalidate(book_id).await;
        
        // Invalidate audio tracks list
        self.audio_tracks_list.invalidate(book_id).await;
        
        // Invalidate all chapters for this book (we need to iterate, but this is expensive)
        // Instead, we'll rely on TTL and manual invalidation of specific chapters
        // For now, we'll just clear the chapters list cache
    }

    /// Invalidate a specific chapter
    pub async fn invalidate_chapter(&self, book_id: &str, chapter_id: &str) {
        self.chapters.invalidate(&(book_id.to_string(), chapter_id.to_string())).await;
        self.chapters_list.invalidate(book_id).await;
    }

    /// Invalidate an image
    pub async fn invalidate_image(&self, book_id: &str, href: &str) {
        self.images.invalidate(&(book_id.to_string(), href.to_string())).await;
    }

    /// Invalidate audio data
    pub async fn invalidate_audio_data(&self, book_id: &str, href: &str) {
        self.audio_data.invalidate(&(book_id.to_string(), href.to_string())).await;
        self.audio_tracks_list.invalidate(book_id).await;
    }

    /// Clear all caches
    pub async fn clear_all(&self) {
        self.books.invalidate_all();
        self.chapters.invalidate_all();
        self.chapters_list.invalidate_all();
        self.audio_tracks_list.invalidate_all();
        self.images.invalidate_all();
        self.audio_data.invalidate_all();
    }
}

impl Default for DbCache {
    fn default() -> Self {
        Self::new()
    }
}

