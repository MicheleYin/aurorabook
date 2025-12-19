use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::time::{Duration, Instant};
use crate::book_service::models::*;

/// Access tracking for LRU eviction
#[derive(Clone, Debug)]
struct AccessInfo {
    last_accessed: Instant,
    access_count: u64,
    size_bytes: usize, // Estimated size in memory
}

/// Hybrid in-memory store with eviction
/// Only keeps frequently accessed data in memory, falls back to SQLite for cold data
pub struct HybridStore {
    // Primary data stores (concurrent HashMaps)
    books: DashMap<String, Book>,
    chapters: DashMap<String, Vec<Chapter>>, // book_id -> chapters
    individual_chapters: DashMap<String, Chapter>, // key: "{book_id}:{chapter_id}" -> chapter
    audio_tracks: DashMap<String, Vec<AudioTrack>>, // book_id -> tracks
    images: DashMap<String, (String, Vec<u8>)>, // key: "{book_id}:{href}" -> (mime_type, data)
    audio_data: DashMap<String, Vec<u8>>, // key: "{book_id}:{href}" -> data
    app_settings: DashMap<String, AppSettings>, // key: "default" -> settings
    reader_preferences: DashMap<String, ReaderPreferences>, // key: "default" -> preferences
    
    // Access tracking for eviction
    book_access: DashMap<String, AccessInfo>,
    chapter_access: DashMap<String, AccessInfo>, // book_id
    audio_track_access: DashMap<String, AccessInfo>, // book_id
    image_access: DashMap<String, AccessInfo>, // key: "{book_id}:{href}"
    audio_data_access: DashMap<String, AccessInfo>, // key: "{book_id}:{href}"
    
    // Write queue for batching SQLite syncs
    write_queue: Arc<RwLock<Vec<WriteOperation>>>,
    
    // Configuration
    max_books_in_memory: usize,
    max_chapters_in_memory: usize,
    max_audio_tracks_in_memory: usize,
    max_images_in_memory: usize,
    max_audio_data_in_memory: usize,
    sync_interval: Duration,
    last_sync: Arc<RwLock<Instant>>,
    
    // Track what's loaded (for efficient queries)
    loaded_books: DashMap<String, bool>, // book_id -> is_loaded
}

#[derive(Clone, Debug)]
pub enum WriteOperation {
    SaveBook(Book),
    UpdateBookProgress { book_id: String, progress: BookProgress },
    UpdateBookAudioState { book_id: String, audio_state: BookAudioState },
    SaveChapter { book_id: String, chapter: Chapter },
    UpdateChapterContent { 
        book_id: String, 
        chapter_id: String, 
        content_html: String, 
        plain_text: Option<String> 
    },
    SaveAudioTrack { book_id: String, track: AudioTrack },
    SaveImage { book_id: String, href: String, mime_type: String, data: Vec<u8> },
    SaveAudioData { book_id: String, href: String, data: Vec<u8> },
    SaveAppSettings(AppSettings),
    SaveReaderPreferences(ReaderPreferences),
    DeleteBook { book_id: String },
}

impl HybridStore {
    pub fn new(
        max_books: usize,
        max_chapters: usize,
        max_audio_tracks: usize,
        sync_interval: Duration,
    ) -> Self {
        Self {
            books: DashMap::new(),
            chapters: DashMap::new(),
            individual_chapters: DashMap::new(),
            audio_tracks: DashMap::new(),
            images: DashMap::new(),
            audio_data: DashMap::new(),
            app_settings: DashMap::new(),
            reader_preferences: DashMap::new(),
            book_access: DashMap::new(),
            chapter_access: DashMap::new(),
            audio_track_access: DashMap::new(),
            image_access: DashMap::new(),
            audio_data_access: DashMap::new(),
            write_queue: Arc::new(RwLock::new(Vec::new())),
            max_books_in_memory: max_books,
            max_chapters_in_memory: max_chapters,
            max_audio_tracks_in_memory: max_audio_tracks,
            max_images_in_memory: 500, // Default limit for images
            max_audio_data_in_memory: 200, // Default limit for audio data
            sync_interval,
            last_sync: Arc::new(RwLock::new(Instant::now())),
            loaded_books: DashMap::new(),
        }
    }
    
    /// Get book from memory (if loaded), returns None if not in memory
    pub fn get_book(&self, book_id: &str) -> Option<Book> {
        if let Some(book) = self.books.get(book_id) {
            // Update access tracking
            self.book_access.entry(book_id.to_string()).and_modify(|info| {
                info.last_accessed = Instant::now();
                info.access_count += 1;
            }).or_insert_with(|| AccessInfo {
                last_accessed: Instant::now(),
                access_count: 1,
                size_bytes: Self::estimate_book_size(book.value()),
            });
            
            Some(book.value().clone())
        } else {
            None
        }
    }
    
    /// Get chapters from memory (if loaded)
    pub fn get_chapters(&self, book_id: &str) -> Option<Vec<Chapter>> {
        if let Some(chapters) = self.chapters.get(book_id) {
            // Update access tracking
            self.chapter_access.entry(book_id.to_string()).and_modify(|info| {
                info.last_accessed = Instant::now();
                info.access_count += 1;
            }).or_insert_with(|| {
                let size = Self::estimate_chapters_size(chapters.value());
                AccessInfo {
                    last_accessed: Instant::now(),
                    access_count: 1,
                    size_bytes: size,
                }
            });
            
            Some(chapters.value().clone())
        } else {
            None
        }
    }
    
    /// Get audio tracks from memory (if loaded)
    pub fn get_audio_tracks(&self, book_id: &str) -> Option<Vec<AudioTrack>> {
        if let Some(tracks) = self.audio_tracks.get(book_id) {
            // Update access tracking
            self.audio_track_access.entry(book_id.to_string()).and_modify(|info| {
                info.last_accessed = Instant::now();
                info.access_count += 1;
            }).or_insert_with(|| {
                let size = Self::estimate_audio_tracks_size(tracks.value());
                AccessInfo {
                    last_accessed: Instant::now(),
                    access_count: 1,
                    size_bytes: size,
                }
            });
            
            Some(tracks.value().clone())
        } else {
            None
        }
    }
    
    /// Get individual chapter from memory
    pub fn get_chapter(&self, book_id: &str, chapter_id: &str) -> Option<Chapter> {
        let key = format!("{}:{}", book_id, chapter_id);
        self.individual_chapters.get(&key).map(|entry| entry.value().clone())
    }
    
    /// Get image from memory
    pub fn get_image(&self, book_id: &str, href: &str) -> Option<(String, Vec<u8>)> {
        let key = format!("{}:{}", book_id, href);
        if let Some(image) = self.images.get(&key) {
            // Update access tracking
            self.image_access.entry(key.clone()).and_modify(|info| {
                info.last_accessed = Instant::now();
                info.access_count += 1;
            }).or_insert_with(|| AccessInfo {
                last_accessed: Instant::now(),
                access_count: 1,
                size_bytes: image.value().1.len(),
            });
            
            Some(image.value().clone())
        } else {
            None
        }
    }
    
    /// Get audio data from memory
    pub fn get_audio_data(&self, book_id: &str, href: &str) -> Option<Vec<u8>> {
        let key = format!("{}:{}", book_id, href);
        if let Some(data) = self.audio_data.get(&key) {
            // Update access tracking
            self.audio_data_access.entry(key.clone()).and_modify(|info| {
                info.last_accessed = Instant::now();
                info.access_count += 1;
            }).or_insert_with(|| AccessInfo {
                last_accessed: Instant::now(),
                access_count: 1,
                size_bytes: data.value().len(),
            });
            
            Some(data.value().clone())
        } else {
            None
        }
    }
    
    /// Get app settings from memory
    pub fn get_app_settings(&self) -> Option<AppSettings> {
        self.app_settings.get("default").map(|entry| entry.value().clone())
    }
    
    /// Get reader preferences from memory
    pub fn get_reader_preferences(&self) -> Option<ReaderPreferences> {
        self.reader_preferences.get("default").map(|entry| entry.value().clone())
    }
    
    /// Load book into memory (with eviction if needed)
    pub async fn load_book(&self, book: Book) {
        // Check if we need to evict
        if self.books_count() >= self.max_books_in_memory {
            self.evict_least_recently_used_book().await;
        }
        
        // Insert book
        self.books.insert(book.id.clone(), book.clone());
        self.loaded_books.insert(book.id.clone(), true);
        
        // Update access tracking
        self.book_access.insert(book.id.clone(), AccessInfo {
            last_accessed: Instant::now(),
            access_count: 1,
            size_bytes: Self::estimate_book_size(&book),
        });
    }
    
    /// Load chapters into memory (with eviction if needed)
    pub async fn load_chapters(&self, book_id: String, chapters: Vec<Chapter>) {
        // Check if we need to evict
        if self.chapters_count() >= self.max_chapters_in_memory {
            self.evict_least_recently_used_chapters().await;
        }
        
        // Insert chapters
        self.chapters.insert(book_id.clone(), chapters.clone());
        
        // Update access tracking
        let size = Self::estimate_chapters_size(&chapters);
        self.chapter_access.insert(book_id, AccessInfo {
            last_accessed: Instant::now(),
            access_count: 1,
            size_bytes: size,
        });
    }
    
    /// Load audio tracks into memory (with eviction if needed)
    pub async fn load_audio_tracks(&self, book_id: String, tracks: Vec<AudioTrack>) {
        // Check if we need to evict
        if self.audio_tracks_count() >= self.max_audio_tracks_in_memory {
            self.evict_least_recently_used_audio_tracks().await;
        }
        
        // Insert tracks
        self.audio_tracks.insert(book_id.clone(), tracks.clone());
        
        // Update access tracking
        let size = Self::estimate_audio_tracks_size(&tracks);
        self.audio_track_access.insert(book_id, AccessInfo {
            last_accessed: Instant::now(),
            access_count: 1,
            size_bytes: size,
        });
    }
    
    /// Evict least recently used book
    async fn evict_least_recently_used_book(&self) {
        let mut lru_book_id: Option<String> = None;
        let mut lru_time = Instant::now();
        
        // Find least recently accessed book
        for entry in self.book_access.iter() {
            if entry.value().last_accessed < lru_time {
                lru_time = entry.value().last_accessed;
                lru_book_id = Some(entry.key().clone());
            }
        }
        
        if let Some(book_id) = lru_book_id {
            log::debug!("Evicting book from memory: {}", book_id);
            self.books.remove(&book_id);
            self.book_access.remove(&book_id);
            self.loaded_books.remove(&book_id);
            // Also evict related chapters and audio tracks
            self.chapters.remove(&book_id);
            self.chapter_access.remove(&book_id);
            self.audio_tracks.remove(&book_id);
            self.audio_track_access.remove(&book_id);
        }
    }
    
    /// Evict least recently used chapters
    async fn evict_least_recently_used_chapters(&self) {
        let mut lru_book_id: Option<String> = None;
        let mut lru_time = Instant::now();
        
        for entry in self.chapter_access.iter() {
            if entry.value().last_accessed < lru_time {
                lru_time = entry.value().last_accessed;
                lru_book_id = Some(entry.key().clone());
            }
        }
        
        if let Some(book_id) = lru_book_id {
            log::debug!("Evicting chapters from memory: {}", book_id);
            self.chapters.remove(&book_id);
            self.chapter_access.remove(&book_id);
        }
    }
    
    /// Evict least recently used audio tracks
    async fn evict_least_recently_used_audio_tracks(&self) {
        let mut lru_book_id: Option<String> = None;
        let mut lru_time = Instant::now();
        
        for entry in self.audio_track_access.iter() {
            if entry.value().last_accessed < lru_time {
                lru_time = entry.value().last_accessed;
                lru_book_id = Some(entry.key().clone());
            }
        }
        
        if let Some(book_id) = lru_book_id {
            log::debug!("Evicting audio tracks from memory: {}", book_id);
            self.audio_tracks.remove(&book_id);
            self.audio_track_access.remove(&book_id);
        }
    }
    
    /// Check if book is loaded in memory
    pub fn is_book_loaded(&self, book_id: &str) -> bool {
        self.loaded_books.contains_key(book_id)
    }
    
    /// Save book (writes to memory if loaded, queues for SQLite)
    pub async fn save_book(&self, book: Book) {
        // If book is in memory, update it
        if self.is_book_loaded(&book.id) {
            self.books.insert(book.id.clone(), book.clone());
        }
        
        // Queue for SQLite sync
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::SaveBook(book));
    }
    
    /// Update progress (updates memory if loaded, queues for SQLite)
    pub async fn update_progress(&self, book_id: String, progress: BookProgress) {
        // Update in-memory store if loaded
        if let Some(mut book) = self.books.get_mut(&book_id) {
            book.progress = Some(progress.clone());
        }
        
        // Queue for SQLite sync
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::UpdateBookProgress { book_id, progress });
    }
    
    /// Update audio state (updates memory if loaded, queues for SQLite)
    pub async fn update_audio_state(&self, book_id: String, audio_state: BookAudioState) {
        if let Some(mut book) = self.books.get_mut(&book_id) {
            book.audio_state = Some(audio_state.clone());
        }
        
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::UpdateBookAudioState { book_id, audio_state });
    }
    
    /// Save chapter (updates memory if loaded, queues for SQLite)
    pub async fn save_chapter(&self, book_id: String, chapter: Chapter) {
        // Update chapters list if loaded
        if let Some(mut chapters) = self.chapters.get_mut(&book_id) {
            // Find and update or insert
            if let Some(pos) = chapters.iter().position(|c| c.id == chapter.id) {
                chapters[pos] = chapter.clone();
            } else {
                chapters.push(chapter.clone());
            }
        }
        
        // Also cache individual chapter
        let chapter_key = format!("{}:{}", book_id, chapter.id);
        self.individual_chapters.insert(chapter_key, chapter.clone());
        
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::SaveChapter { book_id, chapter });
    }
    
    /// Update chapter content (updates memory if loaded, queues for SQLite)
    pub async fn update_chapter_content(&self, book_id: String, chapter_id: String, content_html: String, plain_text: Option<String>) {
        // Update in chapters list if loaded
        if let Some(mut chapters) = self.chapters.get_mut(&book_id) {
            if let Some(chapter) = chapters.iter_mut().find(|c| c.id == chapter_id) {
                chapter.content_html = Some(content_html.clone());
                chapter.plain_text = plain_text.clone();
            }
        }
        
        // Update individual chapter cache
        let chapter_key = format!("{}:{}", book_id, chapter_id);
        if let Some(mut chapter) = self.individual_chapters.get_mut(&chapter_key) {
            chapter.content_html = Some(content_html.clone());
            chapter.plain_text = plain_text.clone();
        }
        
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::UpdateChapterContent { book_id, chapter_id, content_html, plain_text });
    }
    
    /// Save image (updates memory, queues for SQLite)
    pub async fn save_image(&self, book_id: String, href: String, mime_type: String, data: Vec<u8>) {
        let key = format!("{}:{}", book_id, href);
        
        // Check if we need to evict
        if self.images.len() >= self.max_images_in_memory {
            self.evict_least_recently_used_image().await;
        }
        
        self.images.insert(key.clone(), (mime_type.clone(), data.clone()));
        self.image_access.insert(key, AccessInfo {
            last_accessed: Instant::now(),
            access_count: 1,
            size_bytes: data.len(),
        });
        
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::SaveImage { book_id, href, mime_type, data });
    }
    
    /// Save audio data (updates memory, queues for SQLite)
    pub async fn save_audio_data(&self, book_id: String, href: String, data: Vec<u8>) {
        let key = format!("{}:{}", book_id, href);
        
        // Check if we need to evict
        if self.audio_data.len() >= self.max_audio_data_in_memory {
            self.evict_least_recently_used_audio_data().await;
        }
        
        self.audio_data.insert(key.clone(), data.clone());
        self.audio_data_access.insert(key, AccessInfo {
            last_accessed: Instant::now(),
            access_count: 1,
            size_bytes: data.len(),
        });
        
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::SaveAudioData { book_id, href, data });
    }
    
    /// Save app settings (updates memory, queues for SQLite)
    pub async fn save_app_settings(&self, settings: AppSettings) {
        self.app_settings.insert("default".to_string(), settings.clone());
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::SaveAppSettings(settings));
    }
    
    /// Save reader preferences (updates memory, queues for SQLite)
    pub async fn save_reader_preferences(&self, preferences: ReaderPreferences) {
        self.reader_preferences.insert("default".to_string(), preferences.clone());
        let mut queue = self.write_queue.write().await;
        queue.push(WriteOperation::SaveReaderPreferences(preferences));
    }
    
    /// Load image into memory
    pub async fn load_image(&self, book_id: String, href: String, mime_type: String, data: Vec<u8>) {
        let key = format!("{}:{}", book_id, href);
        
        if self.images.len() >= self.max_images_in_memory {
            self.evict_least_recently_used_image().await;
        }
        
        self.images.insert(key.clone(), (mime_type, data.clone()));
        self.image_access.insert(key, AccessInfo {
            last_accessed: Instant::now(),
            access_count: 1,
            size_bytes: data.len(),
        });
    }
    
    /// Load audio data into memory
    pub async fn load_audio_data(&self, book_id: String, href: String, data: Vec<u8>) {
        let key = format!("{}:{}", book_id, href);
        
        if self.audio_data.len() >= self.max_audio_data_in_memory {
            self.evict_least_recently_used_audio_data().await;
        }
        
        self.audio_data.insert(key.clone(), data.clone());
        self.audio_data_access.insert(key, AccessInfo {
            last_accessed: Instant::now(),
            access_count: 1,
            size_bytes: data.len(),
        });
    }
    
    /// Load app settings into memory
    pub fn load_app_settings(&self, settings: AppSettings) {
        self.app_settings.insert("default".to_string(), settings);
    }
    
    /// Load reader preferences into memory
    pub fn load_reader_preferences(&self, preferences: ReaderPreferences) {
        self.reader_preferences.insert("default".to_string(), preferences);
    }
    
    /// Evict least recently used image
    async fn evict_least_recently_used_image(&self) {
        let mut lru_key: Option<String> = None;
        let mut lru_time = Instant::now();
        
        for entry in self.image_access.iter() {
            if entry.value().last_accessed < lru_time {
                lru_time = entry.value().last_accessed;
                lru_key = Some(entry.key().clone());
            }
        }
        
        if let Some(key) = lru_key {
            log::debug!("Evicting image from memory: {}", key);
            self.images.remove(&key);
            self.image_access.remove(&key);
        }
    }
    
    /// Evict least recently used audio data
    async fn evict_least_recently_used_audio_data(&self) {
        let mut lru_key: Option<String> = None;
        let mut lru_time = Instant::now();
        
        for entry in self.audio_data_access.iter() {
            if entry.value().last_accessed < lru_time {
                lru_time = entry.value().last_accessed;
                lru_key = Some(entry.key().clone());
            }
        }
        
        if let Some(key) = lru_key {
            log::debug!("Evicting audio data from memory: {}", key);
            self.audio_data.remove(&key);
            self.audio_data_access.remove(&key);
        }
    }
    
    /// Get pending write count
    pub async fn pending_writes(&self) -> usize {
        self.write_queue.read().await.len()
    }
    
    /// Drain write queue (for sync)
    pub async fn drain_write_queue(&self) -> Vec<WriteOperation> {
        let mut queue = self.write_queue.write().await;
        queue.drain(..).collect()
    }
    
    /// Get memory statistics
    pub fn get_stats(&self) -> serde_json::Value {
        serde_json::json!({
            "books_in_memory": self.books_count(),
            "chapters_in_memory": self.chapters_count(),
            "audio_tracks_in_memory": self.audio_tracks_count(),
            "max_books": self.max_books_in_memory,
            "max_chapters": self.max_chapters_in_memory,
            "max_audio_tracks": self.max_audio_tracks_in_memory,
        })
    }
    
    /// Get count of books in memory
    pub fn books_count(&self) -> usize {
        self.books.len()
    }
    
    /// Get count of chapter lists in memory
    pub fn chapters_count(&self) -> usize {
        self.chapters.len()
    }
    
    /// Get count of audio track lists in memory
    pub fn audio_tracks_count(&self) -> usize {
        self.audio_tracks.len()
    }
    
    /// Get sync interval (for background task)
    pub fn sync_interval(&self) -> Duration {
        self.sync_interval
    }
    
    /// Get last sync time
    pub fn last_sync(&self) -> Arc<RwLock<Instant>> {
        self.last_sync.clone()
    }
    
    // Helper functions for size estimation
    fn estimate_book_size(book: &Book) -> usize {
        // Rough estimate: book metadata + chapters count + audio tracks count
        std::mem::size_of::<Book>() + 
        book.chapters.len() * 100 + // Rough estimate per chapter
        book.audio_tracks.len() * 50 // Rough estimate per track
    }
    
    fn estimate_chapters_size(chapters: &[Chapter]) -> usize {
        chapters.iter().map(|c| {
            std::mem::size_of::<Chapter>() + 
            c.content_html.as_ref().map(|s| s.len()).unwrap_or(0) + 
            c.plain_text.as_ref().map(|t| t.len()).unwrap_or(0)
        }).sum()
    }
    
    fn estimate_audio_tracks_size(tracks: &[AudioTrack]) -> usize {
        tracks.len() * std::mem::size_of::<AudioTrack>()
    }
}

