use leptos::*;
use crate::types::{Book, VoiceId};
use crate::types::conversion::{ConversionProgress, ConversionProgressPayload};
use crate::services::conversion_service::{convert_epub_to_audiobook, cancel_conversion};
use crate::hooks::use_toast::use_toast;
use std::collections::HashMap;
use web_sys;
use js_sys;
use wasm_bindgen::JsCast;

#[derive(Clone)]
pub struct ConversionContext {
    conversion_progress: RwSignal<HashMap<String, ConversionProgress>>,
    converting_book_id: RwSignal<Option<String>>,
    cancelling_book_id: RwSignal<Option<String>>,
    conversion_start_times: RwSignal<HashMap<String, f64>>, // book_id -> start timestamp
    abort_controllers: RwSignal<HashMap<String, js_sys::Object>>, // book_id -> AbortController (as js_sys::Object)
    converting_source_paths: RwSignal<HashMap<String, String>>, // book_id -> source_path
}

impl ConversionContext {
    pub fn new() -> Self {
        Self {
            conversion_progress: create_rw_signal(HashMap::new()),
            converting_book_id: create_rw_signal(None),
            cancelling_book_id: create_rw_signal(None),
            conversion_start_times: create_rw_signal(HashMap::new()),
            abort_controllers: create_rw_signal(HashMap::new()),
            converting_source_paths: create_rw_signal(HashMap::new()),
        }
    }
    
    pub fn set_start_time(&self, book_id: String, timestamp: f64) {
        self.conversion_start_times.update(|map| {
            map.insert(book_id, timestamp);
        });
    }
    
    pub fn get_start_time(&self, book_id: &str) -> Option<f64> {
        self.conversion_start_times.get().get(book_id).copied()
    }
    
    pub fn clear_start_time(&self, book_id: &str) {
        self.conversion_start_times.update(|map| {
            map.remove(book_id);
        });
    }

    pub fn get_progress(&self) -> ReadSignal<HashMap<String, ConversionProgress>> {
        self.conversion_progress.read_only()
    }

    pub fn get_progress_for_book(&self, book_id: &str) -> Option<ConversionProgress> {
        self.conversion_progress.get().get(book_id).cloned()
    }

    pub fn set_progress(&self, book_id: String, progress: ConversionProgress) {
        self.conversion_progress.update(|map| {
            map.insert(book_id, progress);
        });
    }

    pub fn clear_progress(&self, book_id: &str) {
        self.conversion_progress.update(|map| {
            map.remove(book_id);
        });
    }

    pub fn get_converting_book_id(&self) -> ReadSignal<Option<String>> {
        self.converting_book_id.read_only()
    }

    pub fn set_converting_book_id(&self, book_id: Option<String>) {
        self.converting_book_id.set(book_id);
    }

    pub fn get_cancelling_book_id(&self) -> ReadSignal<Option<String>> {
        self.cancelling_book_id.read_only()
    }

    pub fn set_cancelling_book_id(&self, book_id: Option<String>) {
        self.cancelling_book_id.set(book_id);
    }

    pub fn set_abort_controller(&self, book_id: String, controller: js_sys::Object) {
        self.abort_controllers.update(|map| {
            map.insert(book_id, controller);
        });
    }

    pub fn get_abort_controller(&self, book_id: &str) -> Option<js_sys::Object> {
        self.abort_controllers.get().get(book_id).cloned()
    }

    pub fn clear_abort_controller(&self, book_id: &str) {
        self.abort_controllers.update(|map| {
            map.remove(book_id);
        });
    }

    pub fn set_converting_source_path(&self, book_id: String, source_path: String) {
        self.converting_source_paths.update(|map| {
            map.insert(book_id, source_path);
        });
    }

    pub fn get_converting_source_path(&self, book_id: &str) -> Option<String> {
        self.converting_source_paths.get().get(book_id).cloned()
    }

    pub fn clear_converting_source_path(&self, book_id: &str) {
        self.converting_source_paths.update(|map| {
            map.remove(book_id);
        });
    }
}

pub fn use_conversion() -> ConversionApi {
    let context = use_context::<ConversionContext>()
        .expect("use_conversion must be used within a ConversionProvider");
    
    ConversionApi::new(context)
}

#[derive(Clone)]
pub struct ConversionApi {
    context: ConversionContext,
}

impl ConversionApi {
    fn new(context: ConversionContext) -> Self {
        Self { context }
    }

    pub fn get_progress(&self, book_id: &str) -> Option<ConversionProgress> {
        self.context.get_progress_for_book(book_id)
    }

    pub fn get_progress_signal(&self) -> ReadSignal<HashMap<String, ConversionProgress>> {
        self.context.get_progress()
    }

    pub fn is_converting(&self, book_id: &str) -> bool {
        self.context.get_converting_book_id().get().as_ref().map(|id| id == book_id).unwrap_or(false)
    }

    pub fn is_cancelling(&self, book_id: &str) -> bool {
        self.context.get_cancelling_book_id().get().as_ref().map(|id| id == book_id).unwrap_or(false)
    }
    
    pub fn get_start_time(&self, book_id: &str) -> Option<f64> {
        self.context.get_start_time(book_id)
    }

    pub async fn convert_book(&self, book: Book, voice_id: VoiceId, refresh_library: Callback<()>) -> Result<(), String> {
        let book_id = book.id.clone();
        let source_path = book.source_path.clone();
        let toast = use_toast();
        
        // Create AbortController for this conversion via JavaScript
        let window = web_sys::window().ok_or("Window not available")?;
        let abort_controller_ctor = js_sys::Reflect::get(&window, &"AbortController".into())
            .map_err(|_| "AbortController not available")?;
        let abort_controller_js = js_sys::Reflect::construct(
            &abort_controller_ctor.dyn_into::<js_sys::Function>()
                .map_err(|_| "AbortController is not a constructor")?,
            &js_sys::Array::new(),
        ).map_err(|_| "Failed to create AbortController")?;
        let abort_controller = abort_controller_js.dyn_into::<js_sys::Object>()
            .map_err(|_| "AbortController is not an object")?;
        self.context.set_abort_controller(book_id.clone(), abort_controller.clone());
        self.context.set_converting_source_path(book_id.clone(), source_path.clone());
        
        // Set converting state and start time
        self.context.set_converting_book_id(Some(book_id.clone()));
        self.context.set_start_time(book_id.clone(), js_sys::Date::now());
        
        // Update book state before conversion starts (for resuming)
        let library = use_context::<leptos::RwSignal<Vec<Book>>>();
        if let Some(lib) = library {
            lib.update(|books| {
                if let Some(index) = books.iter().position(|b| b.id == book_id || b.source_path == source_path) {
                    books[index].voice_id = Some(voice_id.clone());
                    books[index].conversion_status = Some("started".to_string());
                }
            });
        }
        
        // Set initial progress state
        self.context.set_progress(book_id.clone(), ConversionProgress {
            current_chapter: 0,
            total_chapters: 0,
            words_processed: 0,
            total_words: 0,
            words_in_current_chapter: 0,
            current_step: crate::types::conversion::ConversionStep::Initializing,
            message: "Starting conversion...".to_string(),
        });
        
        // Check for cancellation before starting
        let signal = js_sys::Reflect::get(&abort_controller, &"signal".into())
            .ok()
            .and_then(|s| s.dyn_into::<js_sys::Object>().ok());
        let is_aborted = signal.as_ref()
            .and_then(|s| js_sys::Reflect::get(s, &"aborted".into()).ok())
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let signal_clone = signal.clone();
        if is_aborted {
            self.context.clear_abort_controller(&book_id);
            self.context.clear_converting_source_path(&book_id);
            self.context.clear_progress(&book_id);
            self.context.clear_start_time(&book_id);
            self.context.set_converting_book_id(None);
            return Err("Conversion cancelled".to_string());
        }
        
        // Start conversion
        let conversion_result = convert_epub_to_audiobook(&book.id, &voice_id).await;
        
        // Check if cancelled after conversion
        let was_cancelled = signal_clone.as_ref()
            .and_then(|s| js_sys::Reflect::get(s, &"aborted".into()).ok())
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        
        match conversion_result {
            Ok(Some(_updated_book)) => {
                // Clear all conversion state
                self.context.clear_abort_controller(&book_id);
                self.context.clear_converting_source_path(&book_id);
                self.context.clear_progress(&book_id);
                self.context.clear_start_time(&book_id);
                self.context.set_converting_book_id(None);
                
                // Clear book cache to force fresh data from backend
                if let Some(reader_state) = use_context::<crate::hooks::use_reader_state::ReaderState>() {
                    reader_state.clear_loaded_chapters_for_book(&book_id);
                }
                
                // Refresh library
                refresh_library.call(());
                
                if !was_cancelled {
                    toast.success(
                        "Audiobook ready!".to_string(),
                        Some("Your ebook has been converted to an audiobook.".to_string())
                    );
                }
                
                Ok(())
            }
            Ok(None) => {
                self.context.clear_abort_controller(&book_id);
                self.context.clear_converting_source_path(&book_id);
                self.context.clear_progress(&book_id);
                self.context.clear_start_time(&book_id);
                self.context.set_converting_book_id(None);
                Err("Conversion returned no book".to_string())
            }
            Err(e) => {
                // Don't show error toast if conversion was cancelled
                if !was_cancelled && !e.to_lowercase().contains("cancelled") {
                    toast.error(
                        "Conversion failed".to_string(),
                        Some(e.clone())
                    );
                }
                self.context.clear_abort_controller(&book_id);
                self.context.clear_converting_source_path(&book_id);
                self.context.clear_progress(&book_id);
                self.context.clear_start_time(&book_id);
                self.context.set_converting_book_id(None);
                Err(e)
            }
        }
    }

    pub async fn cancel_conversion_for_book(&self, book: &Book) -> Result<(), String> {
        let book_id = book.id.clone();
        let source_path = book.source_path.clone();
        
        // Set cancelling state immediately for responsive UI
        self.context.set_cancelling_book_id(Some(book_id.clone()));
        
        // Abort frontend signal immediately for responsive cancellation
        if let Some(abort_controller) = self.context.get_abort_controller(&book_id) {
            if let Ok(abort_fn) = js_sys::Reflect::get(&abort_controller, &"abort".into()) {
                if let Ok(abort_func) = abort_fn.dyn_into::<js_sys::Function>() {
                    let _ = js_sys::Reflect::apply(&abort_func, &abort_controller, &js_sys::Array::new());
                }
            }
        }
        
        // Get source path from context if available (more reliable)
        let actual_source_path = self.context.get_converting_source_path(&book_id)
            .unwrap_or(source_path);
        
        // Call backend cancellation command
        let cancel_result = cancel_conversion(&actual_source_path).await;
        
        // Clear frontend conversion state immediately for instant UI feedback
        // But keep isCancelling true until we receive the event from backend
        self.context.clear_abort_controller(&book_id);
        self.context.clear_converting_source_path(&book_id);
        self.context.set_converting_book_id(None);
        
        match cancel_result {
            Ok(_) => {
                // Note: We don't clear isCancelling or show toast here
                // That will happen when we receive the conversion-cancelled event from backend
                // This ensures the UI shows "pausing" state immediately but final state only after backend confirms
                Ok(())
            }
            Err(e) => {
                // If backend call fails, still clear the cancelling state
                self.context.set_cancelling_book_id(None);
                Err(e)
            }
        }
    }
}

#[component]
pub fn ConversionProvider(children: Children) -> impl IntoView {
    let context = ConversionContext::new();
    provide_context(context.clone());
    
    // Set up event listeners for conversion events
    leptos::spawn_local({
        let context_clone = context.clone();
        let library = use_context::<leptos::RwSignal<Vec<Book>>>();
        let refresh_library = use_context::<Callback<()>>();
        let toast = crate::hooks::use_toast::use_toast();
        
        async move {
            // Listen for conversion-progress events
            if let Ok(_unlisten_progress) = crate::services::tauri_event_service::listen_tauri_event::<ConversionProgressPayload>(
                "conversion-progress",
                {
                    let context_for_callback = context_clone.clone();
                    let library_for_callback = library.clone();
                    move |payload: ConversionProgressPayload| {
                        // Find which book is converting by checking source_path, book_id, or converting_book_id
                        let book_id_opt = payload.book_id.clone()
                            .or_else(|| {
                                // Try to find by source_path
                                payload.source_path.as_ref().and_then(|source_path| {
                                    library_for_callback.as_ref().and_then(|lib| {
                                        lib.get().iter()
                                            .find(|b| b.source_path == *source_path)
                                            .map(|b| b.id.clone())
                                    })
                                })
                            })
                            .or_else(|| {
                                // Fallback to converting_book_id from context
                                context_for_callback.get_converting_book_id().get()
                            });
                        
                        if let Some(book_id) = book_id_opt {
                            let progress: ConversionProgress = payload.into();
                            context_for_callback.set_progress(book_id.clone(), progress);
                        }
                    }
                },
            ).await {
                // Keep unlisten function alive (stored but not used for cleanup yet)
                let _ = _unlisten_progress;
            }
            
            // Listen for chapter-completed events
            if let Ok(mut unlisten_chapter) = crate::services::tauri_event_service::listen_tauri_event::<serde_json::Value>(
                "chapter-completed",
                {
                    let context_for_callback = context_clone.clone();
                    let library_clone = library.clone();
                    let refresh_clone = refresh_library.clone();
                    let toast_clone = toast.clone();
                    
                    move |payload: serde_json::Value| {
                        // Extract source_path from payload
                        if let Some(source_path) = payload.get("source_path")
                            .and_then(|v| v.as_str())
                        {
                            let source_path = source_path.to_string();
                            
                            // Extract chapter_index (1-based from event)
                            let chapter_index = payload.get("chapter_index")
                                .and_then(|v| v.as_u64())
                                .map(|v| v as usize);
                            
                            // Find book by source_path and refresh it
                            if let Some(lib) = library_clone.as_ref() {
                                let books = lib.get();
                                if let Some(book) = books.iter().find(|b| b.source_path == source_path) {
                                    let book_id = book.id.clone();
                                    
                                    // Clone values needed for async block
                                    let context_for_async = context_for_callback.clone();
                                    let library_for_async = lib.clone();
                                    let refresh_for_async = refresh_clone.clone();
                                    let toast_for_async = toast_clone.clone();
                                    let payload_clone = payload.clone();
                                    let source_path_clone = source_path.clone();
                                    
                                    leptos::spawn_local(async move {
                                        match crate::services::book_service::read_one_book(&book_id).await {
                                            Ok(Some(updated_book)) => {
                                                // Find the completed chapter by index (chapter_index is 1-based in the event)
                                                let completed_chapter_index = chapter_index
                                                    .map(|idx| idx.saturating_sub(1)); // Convert to 0-based
                                                
                                                let completed_chapter = completed_chapter_index
                                                    .and_then(|idx| updated_book.chapters.get(idx))
                                                    .cloned();
                                                
                                                // Clear cache for the specific completed chapter
                                                if let Some(chapter) = &completed_chapter {
                                                    if let Some(reader_state) = use_context::<crate::hooks::use_reader_state::ReaderState>() {
                                                        reader_state.clear_loaded_chapter(&chapter.id);
                                                        
                                                        // Try multiple href variations to ensure we clear all possible cache keys
                                                        let href = &chapter.href;
                                                        let href_variations = vec![
                                                            href.clone(),
                                                            href.trim_start_matches('/').to_string(),
                                                            href.replace("OEBPS/", ""),
                                                            format!("OEBPS/{}", href.trim_start_matches('/').replace("OEBPS/", "")),
                                                        ];
                                                        
                                                        for href_var in href_variations {
                                                            // Try to find chapter by href and clear it
                                                            if let Some(ch_by_href) = updated_book.chapters.iter()
                                                                .find(|ch| ch.href == href_var || ch.href == *href) {
                                                                reader_state.clear_loaded_chapter(&ch_by_href.id);
                                                            }
                                                        }
                                                    }
                                                } else if let Some(_idx) = completed_chapter_index {
                                                    // Chapter index out of bounds, clear all chapters for this book as fallback
                                                    if let Some(reader_state) = use_context::<crate::hooks::use_reader_state::ReaderState>() {
                                                        reader_state.clear_loaded_chapters_for_book(&book_id);
                                                    }
                                                }
                                                
                                                // Merge all book fields (complete merge like React's mergeBookAudioFields)
                                                library_for_async.update(|books| {
                                                    if let Some(index) = books.iter().position(|b| b.id == book_id || b.source_path == source_path_clone) {
                                                        let mut merged = books[index].clone();
                                                        // Merge chapters (updated chapter HTML will be available)
                                                        merged.chapters = updated_book.chapters.clone();
                                                        // Merge audio-related fields
                                                        merged.audio_tracks = updated_book.audio_tracks.clone();
                                                        merged.audio_state = updated_book.audio_state.clone();
                                                        merged.audio_sync_map = updated_book.audio_sync_map.clone();
                                                        merged.voice_id = updated_book.voice_id.clone();
                                                        merged.conversion_status = updated_book.conversion_status.clone();
                                                        // Merge other fields
                                                        merged.file_size_bytes = updated_book.file_size_bytes.clone();
                                                        merged.completed_chapters = updated_book.completed_chapters.clone();
                                                        merged.total_words = updated_book.total_words.clone();
                                                        merged.words_processed = updated_book.words_processed.clone();
                                                        books[index] = merged;
                                                    }
                                                });
                                                
                                                // Emit chapter-updated custom event if we have the completed chapter
                                                if let Some(chapter) = completed_chapter {
                                                    if let Some(window) = web_sys::window() {
                                                        let detail = js_sys::Object::new();
                                                        
                                                        js_sys::Reflect::set(&detail, &"bookId".into(), &book_id.clone().into()).ok();
                                                        js_sys::Reflect::set(&detail, &"sourcePath".into(), &source_path_clone.clone().into()).ok();
                                                        js_sys::Reflect::set(&detail, &"chapterId".into(), &chapter.id.clone().into()).ok();
                                                        js_sys::Reflect::set(&detail, &"chapterHref".into(), &chapter.href.clone().into()).ok();
                                                        if let Some(idx) = chapter_index {
                                                            js_sys::Reflect::set(&detail, &"chapterIndex".into(), &(idx as u32).into()).ok();
                                                        }
                                                        
                                                        // Create CustomEvent via JavaScript
                                                        if let Ok(custom_event_ctor_js) = js_sys::Reflect::get(&window, &"CustomEvent".into()) {
                                                            if let Ok(custom_event_ctor) = custom_event_ctor_js.dyn_into::<js_sys::Function>() {
                                                                let event_init = js_sys::Object::new();
                                                                js_sys::Reflect::set(&event_init, &"detail".into(), &detail).ok();
                                                                let event_args = js_sys::Array::new();
                                                                event_args.push(&"chapter-updated".into());
                                                                event_args.push(&event_init.into());
                                                                
                                                                if let Ok(event) = js_sys::Reflect::construct(&custom_event_ctor, &event_args) {
                                                                    if let Ok(web_event) = event.dyn_into::<web_sys::Event>() {
                                                                        let _ = window.dispatch_event(&web_event);
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                
                                                // Check if audio was generated
                                                if let Some(audio_generated) = payload_clone.get("audio_generated")
                                                    .and_then(|v| v.as_bool())
                                                {
                                                    if audio_generated {
                                                        if let Some(chapter_title) = payload_clone.get("chapter_title")
                                                            .and_then(|v| v.as_str())
                                                        {
                                                            toast_for_async.info(
                                                                "New chapter available".to_string(),
                                                                Some(format!("\"{}\" has been converted and is ready to play.", chapter_title))
                                                            );
                                                        }
                                                    }
                                                }
                                            }
                                            Err(e) => {
                                                web_sys::console::warn_1(&format!("Failed to fetch updated book after chapter completion: {}", e).into());
                                            }
                                            Ok(None) => {
                                                web_sys::console::warn_1(&"Book not found after chapter completion".into());
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                },
            ).await {
                let _ = unlisten_chapter;
            }
            
            // Listen for conversion-cancelled events
            if let Ok(mut unlisten_cancelled) = crate::services::tauri_event_service::listen_tauri_event::<serde_json::Value>(
                "conversion-cancelled",
                {
                    let context_for_callback = context_clone.clone();
                    let library_clone = library.clone();
                    let refresh_clone = refresh_library.clone();
                    let toast_clone = toast.clone();
                    
                    move |payload: serde_json::Value| {
                        if let Some(source_path) = payload.get("source_path")
                            .and_then(|v| v.as_str())
                        {
                            let source_path = source_path.to_string();
                            
                            // Find book and refresh it
                            if let Some(lib) = library_clone.as_ref() {
                                let books = lib.get();
                                if let Some(book) = books.iter().find(|b| b.source_path == source_path) {
                                    let book_id = book.id.clone();
                                    
                                    // Clone values needed for async block
                                    let context_for_async = context_for_callback.clone();
                                    let library_for_async = lib.clone();
                                    let refresh_for_async = refresh_clone.clone();
                                    let toast_for_async = toast_clone.clone();
                                    let source_path_clone = source_path.clone();
                                    
                                    leptos::spawn_local(async move {
                                        match crate::services::book_service::read_one_book(&book_id).await {
                                            Ok(Some(updated_book)) => {
                                                // Merge all book fields (complete merge like React's mergeBookAudioFields)
                                                library_for_async.update(|books| {
                                                    if let Some(index) = books.iter().position(|b| b.id == book_id || b.source_path == source_path_clone) {
                                                        let mut merged = books[index].clone();
                                                        // Merge chapters
                                                        merged.chapters = updated_book.chapters.clone();
                                                        // Merge audio-related fields
                                                        merged.audio_tracks = updated_book.audio_tracks.clone();
                                                        merged.audio_state = updated_book.audio_state.clone();
                                                        merged.audio_sync_map = updated_book.audio_sync_map.clone();
                                                        merged.voice_id = updated_book.voice_id.clone();
                                                        merged.conversion_status = updated_book.conversion_status.clone();
                                                        // Merge other fields
                                                        merged.file_size_bytes = updated_book.file_size_bytes.clone();
                                                        merged.completed_chapters = updated_book.completed_chapters.clone();
                                                        merged.total_words = updated_book.total_words.clone();
                                                        merged.words_processed = updated_book.words_processed.clone();
                                                        books[index] = merged;
                                                    }
                                                });
                                                
                                                // Clear progress and cancelling state
                                                context_for_async.clear_progress(&book_id);
                                                context_for_async.clear_start_time(&book_id);
                                                context_for_async.set_converting_book_id(None);
                                                context_for_async.set_cancelling_book_id(None);
                                                
                                                // Show toast notification
                                                toast_for_async.info(
                                                    "Conversion cancelled".to_string(),
                                                    Some("The conversion has been cancelled.".to_string())
                                                );
                                            }
                                            Err(e) => {
                                                web_sys::console::warn_1(&format!("Failed to fetch updated book after cancellation: {}", e).into());
                                                // Still clear the cancelling state even if refresh failed
                                                context_for_async.set_cancelling_book_id(None);
                                            }
                                            Ok(None) => {
                                                // Still clear the cancelling state
                                                context_for_async.set_cancelling_book_id(None);
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                },
            ).await {
                let _ = unlisten_cancelled;
            }
        }
    });
    
    view! {
        {children()}
    }
}


