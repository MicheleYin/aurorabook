use leptos::*;
use crate::types::reader::{Book, BookProgress};
use crate::services::book_service::invoke_tauri_command;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use serde_wasm_bindgen;
use leptos::spawn_local;

/// Track and save reading progress for a book
pub fn use_reader_progress(
    active_book: impl Fn() -> Option<Book> + Clone + 'static,
    active_chapter_id: impl Fn() -> Option<String> + Clone + 'static,
    content_ref: NodeRef<leptos::html::Div>,
) -> (
    Callback<()>, // save_progress - call to save current progress
    Callback<()>, // restore_progress - call to restore saved progress
) {
    let save_progress = Callback::new({
        let book_fn = active_book.clone();
        let chapter_fn = active_chapter_id.clone();
        let content_node_ref = content_ref.clone();
        move |_| {
            let book = book_fn();
            let chapter_id = chapter_fn();
            let content_element = content_node_ref.get();
            
            if let (Some(book), Some(ch_id), Some(element)) = (book, chapter_id, content_element) {
                let scroll_top = element.scroll_top() as f64;
                let scroll_height = element.scroll_height() as f64;
                let client_height = element.client_height() as f64;
                let percent = if scroll_height > 0.0 {
                    scroll_top / (scroll_height - client_height).max(1.0)
                } else {
                    0.0
                };
                
                // Find chapter index
                let chapter_index = book.chapters.iter()
                    .position(|ch| ch.id == ch_id)
                    .unwrap_or(0);
                
                let chapter = book.chapters.iter().find(|ch| ch.id == ch_id);
                let chapter_href = chapter.map(|ch| ch.href.clone()).unwrap_or_default();
                
                let progress = BookProgress {
                    current_chapter_id: ch_id.clone(),
                    current_chapter_href: chapter_href,
                    current_chapter_index: chapter_index,
                    current_chapter_element_id: None,
                    current_chapter_element_index: None,
                    current_chapter_scroll_top: scroll_top,
                    current_chapter_scroll_height: scroll_height,
                    current_chapter_client_height: client_height,
                    chapter_progress_percent: percent,
                    book_progress_percent: 0.0, // TODO: Calculate from all chapters
                    updated_at: js_sys::Date::new_0().to_iso_string().as_string().unwrap_or_default(),
                };
                
                let book_id = book.id.clone();
                spawn_local(async move {
                    let args = serde_wasm_bindgen::to_value(&serde_json::json!({
                        "bookId": book_id,
                        "progress": progress
                    })).unwrap_or_else(|_| JsValue::NULL);
                    
                    if let Err(e) = invoke_tauri_command::<()>("update_book_progress", args).await {
                        web_sys::console::warn_1(&format!("Failed to save progress: {}", e).into());
                    }
                });
            }
        }
    });
    
    let restore_progress = Callback::new({
        let book_fn = active_book.clone();
        let chapter_fn = active_chapter_id.clone();
        let content_node_ref = content_ref.clone();
        move |_| {
            let book = book_fn();
            let chapter_id = chapter_fn();
            let content_element = content_node_ref.get();
            
            if let (Some(book), Some(ch_id), Some(element)) = (
                book,
                chapter_id,
                content_element
            ) {
                if let Some(progress) = book.progress.clone() {
                // Only restore if this is the saved chapter
                if progress.current_chapter_id == ch_id {
                    let scroll_top = progress.current_chapter_scroll_top;
                    let scroll_height = progress.current_chapter_scroll_height;
                    let client_height = progress.current_chapter_client_height;
                    
                    // Restore scroll position after DOM is ready
                    let element_clone = element.clone();
                    let progress_clone = progress.clone();
                    spawn_local(async move {
                        // Wait a bit for DOM to be ready using web_sys
                        let window = web_sys::window().unwrap();
                        let promise = js_sys::Promise::new(&mut |resolve, _| {
                            let _timeout = web_sys::window()
                                .unwrap()
                                .set_timeout_with_callback_and_timeout_and_arguments_0(
                                    &resolve,
                                    100
                                )
                                .unwrap();
                        });
                        wasm_bindgen_futures::JsFuture::from(promise).await.ok();
                        
                        let current_scroll_height = element_clone.scroll_height() as f64;
                        let current_client_height = element_clone.client_height() as f64;
                        let saved_scroll_top = progress_clone.current_chapter_scroll_top;
                        let saved_scroll_height = progress_clone.current_chapter_scroll_height;
                        let saved_percent = progress_clone.chapter_progress_percent;
                        
                        // Calculate target scroll position
                        let target_scroll = if saved_scroll_height > 0.0 && current_scroll_height > 0.0 {
                            // Use percent if dimensions don't match closely
                            let height_diff = (current_scroll_height - saved_scroll_height).abs();
                            if height_diff > saved_scroll_height * 0.1 {
                                // Dimensions differ significantly, use percent
                                saved_percent * (current_scroll_height - current_client_height).max(0.0)
                            } else {
                                // Dimensions match, use exact scroll position
                                saved_scroll_top.min((current_scroll_height - current_client_height).max(0.0))
                            }
                        } else {
                            saved_scroll_top
                        };
                        
                        element_clone.set_scroll_top(target_scroll as i32);
                    });
                }
            }
            }
        }
    });
    
    (save_progress, restore_progress)
}
