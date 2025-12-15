use leptos::*;
use crate::types::reader::{Book, Chapter, ReaderPreferences};
use crate::services::chapter_service::load_epub_chapter_blob;
use crate::hooks::use_reader_state::use_reader_state;
use crate::hooks::use_reader_progress::use_reader_progress;
use crate::components::reader::constants::ReaderConstants;
use leptos::spawn_local;
use wasm_bindgen::JsCast;

#[component]
pub fn ReaderViewport(
    active_book: Book,
    active_chapter: Option<Chapter>,
    preferences: ReaderPreferences,
    _on_select_chapter: Option<Callback<String>>,
) -> impl IntoView {
    let reader_state = use_reader_state();
    let (is_loading, set_is_loading) = create_signal(false);
    let (loaded_html, set_loaded_html) = create_signal::<Option<String>>(None);
    let content_ref = create_node_ref::<leptos::html::Div>();
    
    // Get active book signal for progress tracking
    let library = use_context::<leptos::RwSignal<Vec<Book>>>().expect("Library context not found");
    let active_book_id = reader_state.get_active_book_id();
    let active_book_signal = create_memo(move |_| {
        active_book_id.get().and_then(|id| {
            library.get().into_iter().find(|b| b.id == id)
        })
    });
    let active_chapter_id_signal = reader_state.get_active_chapter_id();
    
    // Progress tracking
    let (_save_progress, restore_progress) = use_reader_progress(
        move || active_book_signal.get(),
        move || active_chapter_id_signal.get(),
        content_ref,
    );
    
    // Listen for chapter-updated events to reload chapter if user is viewing it
    create_effect({
        let active_book_id_clone = active_book_id.clone();
        let active_chapter_id_clone = active_chapter_id_signal.clone();
        let set_loading = set_is_loading.clone();
        let set_html = set_loaded_html.clone();
        let reader_state_clone = reader_state.clone();
        let library_clone = library.clone();
        
        move |_| {
            // Only set up listener once when component mounts
            let closure = wasm_bindgen::closure::Closure::wrap(Box::new({
                let active_book_id_for_closure = active_book_id_clone.clone();
                let active_chapter_id_for_closure = active_chapter_id_clone.clone();
                let set_loading_for_closure = set_loading.clone();
                let set_html_for_closure = set_html.clone();
                let reader_state_for_closure = reader_state_clone.clone();
                let library_for_closure = library_clone.clone();
                
                move |event: web_sys::Event| {
                    let custom_event = event.dyn_ref::<web_sys::CustomEvent>().unwrap();
                    let detail = custom_event.detail();
                    
                    // Extract event details
                    let event_book_id = js_sys::Reflect::get(&detail, &"bookId".into())
                        .ok()
                        .and_then(|v| v.as_string());
                    let event_chapter_id = js_sys::Reflect::get(&detail, &"chapterId".into())
                        .ok()
                        .and_then(|v| v.as_string());
                    
                    // Get current active book and chapter
                    let current_book_id = active_book_id_for_closure.get();
                    let current_chapter_id = active_chapter_id_for_closure.get();
                    
                    // Only reload if this is the currently active chapter
                    if let (Some(evt_book_id), Some(evt_chapter_id)) = (event_book_id, event_chapter_id) {
                        if current_book_id.as_ref().map(|id| id == &evt_book_id).unwrap_or(false) &&
                           current_chapter_id.as_ref().map(|id| id == &evt_chapter_id).unwrap_or(false) {
                            
                            // Clear the chapter from cache to force reload
                            reader_state_for_closure.clear_loaded_chapter(&evt_chapter_id);
                            
                            // Reload the chapter
                            let book_id_for_reload = evt_book_id.clone();
                            let chapter_id_for_reload = evt_chapter_id.clone();
                            let set_loading_for_async = set_loading_for_closure.clone();
                            let set_html_for_async = set_html_for_closure.clone();
                            let reader_state_for_async = reader_state_for_closure.clone();
                            let library_for_async = library_for_closure.clone();
                            
                            spawn_local(async move {
                                if let Some(book) = library_for_async.get().into_iter().find(|b| b.id == book_id_for_reload) {
                                    if let Some(chapter) = book.chapters.iter().find(|ch| ch.id == chapter_id_for_reload) {
                                        set_loading_for_async.set(true);
                                        
                                        match load_epub_chapter_blob(&book_id_for_reload, &chapter.href).await {
                                            Ok(Some((_blob_url, html_string))) => {
                                                // Update chapter with loaded content
                                                let mut updated_chapter = chapter.clone();
                                                updated_chapter.content_html = Some(html_string.clone());
                                                reader_state_for_async.set_loaded_chapter(chapter_id_for_reload.clone(), updated_chapter);
                                                
                                                set_html_for_async.set(Some(html_string));
                                                set_loading_for_async.set(false);
                                            }
                                            Ok(None) => {
                                                web_sys::console::warn_1(&format!("Chapter not found after update: {}", chapter.href).into());
                                                set_loading_for_async.set(false);
                                            }
                                            Err(e) => {
                                                web_sys::console::error_1(&format!("Failed to reload chapter after update: {}", e).into());
                                                set_loading_for_async.set(false);
                                            }
                                        }
                                    }
                                }
                            });
                        }
                    }
                }
            }) as Box<dyn FnMut(_)>);
            
            if let Some(window_obj) = web_sys::window() {
                let _ = window_obj.add_event_listener_with_callback("chapter-updated", closure.as_ref().unchecked_ref());
                closure.forget(); // Keep the closure alive
            }
        }
    });
    
    // Load chapter content when chapter changes
    create_effect(move |_| {
        if let Some(chapter) = active_chapter.clone() {
            let chapter_id = chapter.id.clone();
            let book_id = active_book.id.clone();
            let chapter_href = chapter.href.clone();
            let set_loading = set_is_loading.clone();
            let set_html = set_loaded_html.clone();
            let reader_state_clone = reader_state.clone();
            
            // Check if chapter is already loaded
            if let Some(loaded_chapter) = reader_state_clone.get_loaded_chapter(&chapter_id) {
                if let Some(content) = loaded_chapter.content_html {
                    set_html.set(Some(content));
                    set_loading.set(false);
                    return;
                }
            }
            
            set_loading.set(true);
            set_html.set(None);
            
            let chapter_for_async = chapter.clone();
            let chapter_id_for_async = chapter_id.clone();
            spawn_local(async move {
                match load_epub_chapter_blob(&book_id, &chapter_href).await {
                    Ok(Some((_blob_url, html_string))) => {
                        // Update chapter with loaded content
                        let mut updated_chapter = chapter_for_async.clone();
                        updated_chapter.content_html = Some(html_string.clone());
                        reader_state_clone.set_loaded_chapter(chapter_id_for_async.clone(), updated_chapter);
                        
                        set_html.set(Some(html_string));
                        set_loading.set(false);
                        
                        // Restore scroll position after content is loaded
                        // Use a small delay to ensure DOM is ready
                        let restore_clone = restore_progress.clone();
                        spawn_local(async move {
                            // Wait a bit for DOM to be ready using web_sys
                            let window = web_sys::window().unwrap();
                            let promise = js_sys::Promise::new(&mut |resolve, _| {
                                let timeout = web_sys::window()
                                    .unwrap()
                                    .set_timeout_with_callback_and_timeout_and_arguments_0(
                                        &resolve,
                                        100
                                    )
                                    .unwrap();
                                // Keep timeout alive
                                let _ = timeout;
                            });
                            wasm_bindgen_futures::JsFuture::from(promise).await.ok();
                            restore_clone.call(());
                        });
                    }
                    Ok(None) => {
                        web_sys::console::error_1(&format!("Chapter not found: {}", chapter_href).into());
                        set_loading.set(false);
                    }
                    Err(e) => {
                        web_sys::console::error_1(&format!("Failed to load chapter: {}", e).into());
                        set_loading.set(false);
                    }
                }
            });
        } else {
            set_loaded_html.set(None);
            set_is_loading.set(false);
        }
    });
    
    // Apply reader preferences classes
    let font_class = ReaderConstants::font_class(&preferences.font_family);
    let font_size_class = ReaderConstants::font_size_class(&preferences.font_size);
    let line_height_class = ReaderConstants::line_height_class(&preferences.font_size);
    let padding_outer = ReaderConstants::content_padding_outer(&preferences.content_padding);
    let padding_inner = ReaderConstants::content_padding_inner_base(&preferences.content_padding);
    
    view! {
        <div class="flex flex-1 flex-col overflow-hidden">
            <div class=format!("flex-1 overflow-y-auto {}", padding_outer)>
                <article
                    class=format!(
                        "prose prose-lg max-w-none {} {} {} {}",
                        font_class,
                        font_size_class,
                        line_height_class,
                        padding_inner
                    )
                >
                    {move || {
                        if is_loading.get() {
                            view! {
                                <div class="flex items-center justify-center py-12">
                                    <div class="text-muted-foreground">"Loading chapter content..."</div>
                                </div>
                            }.into_view()
                        } else if let Some(html) = loaded_html.get() {
                            view! {
                                <div
                                    node_ref=content_ref
                                    data-reader-chapter-content="true"
                                    class="animate-in fade-in duration-300"
                                    inner_html=html
                                />
                            }.into_view()
                        } else {
                            view! {
                                <div class="flex items-center justify-center py-12">
                                    <div class="text-muted-foreground">"Chapter content not available"</div>
                                </div>
                            }.into_view()
                        }
                    }}
                </article>
            </div>
        </div>
    }
}


