use leptos::*;
use crate::types::reader::Chapter;
use std::collections::HashMap;

#[derive(Clone)]
pub struct ReaderState {
    active_book_id: RwSignal<Option<String>>,
    active_chapter_id: RwSignal<Option<String>>,
    loaded_chapters: RwSignal<HashMap<String, Chapter>>, // chapter_id -> loaded chapter with content
}

impl ReaderState {
    pub fn new() -> Self {
        Self {
            active_book_id: create_rw_signal(None),
            active_chapter_id: create_rw_signal(None),
            loaded_chapters: create_rw_signal(HashMap::new()),
        }
    }

    pub fn get_active_book_id(&self) -> RwSignal<Option<String>> {
        self.active_book_id
    }

    pub fn set_active_book_id(&self, book_id: Option<String>) {
        self.active_book_id.set(book_id);
    }

    pub fn get_active_chapter_id(&self) -> RwSignal<Option<String>> {
        self.active_chapter_id
    }

    pub fn set_active_chapter_id(&self, chapter_id: Option<String>) {
        self.active_chapter_id.set(chapter_id);
    }

    pub fn get_loaded_chapters(&self) -> RwSignal<HashMap<String, Chapter>> {
        self.loaded_chapters
    }

    pub fn set_loaded_chapter(&self, chapter_id: String, chapter: Chapter) {
        self.loaded_chapters.update(|map| {
            map.insert(chapter_id, chapter);
        });
    }

    pub fn get_loaded_chapter(&self, chapter_id: &str) -> Option<Chapter> {
        self.loaded_chapters.get().get(chapter_id).cloned()
    }

    pub fn clear_loaded_chapters(&self) {
        self.loaded_chapters.set(HashMap::new());
    }

    /// Clear a specific chapter from cache by chapter ID
    pub fn clear_loaded_chapter(&self, chapter_id: &str) {
        self.loaded_chapters.update(|map| {
            map.remove(chapter_id);
        });
    }

    /// Clear all chapters for a specific book (by matching chapter IDs that belong to the book)
    /// This is a fallback when we don't have specific chapter IDs
    pub fn clear_loaded_chapters_for_book(&self, _book_id: &str) {
        // Note: In the current implementation, we don't track which book a chapter belongs to
        // in the loaded_chapters map. For now, we'll clear all chapters.
        // This could be improved by storing book_id in the chapter cache key or structure.
        self.loaded_chapters.set(HashMap::new());
    }
}

pub fn use_reader_state() -> ReaderState {
    use_context::<ReaderState>()
        .expect("use_reader_state must be used within a ReaderStateProvider")
}

#[component]
pub fn ReaderStateProvider(children: Children) -> impl IntoView {
    let state = ReaderState::new();
    provide_context(state);
    
    view! {
        {children()}
    }
}


