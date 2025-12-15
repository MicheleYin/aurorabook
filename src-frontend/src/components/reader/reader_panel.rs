use leptos::*;
use crate::types::reader::{Book, Chapter, ReaderPreferences};
use crate::hooks::use_reader_state::use_reader_state;
use crate::components::ui::{Button, ButtonVariant, ButtonSize};
use crate::components::icons::{ArrowLeft, Settings2};
use crate::components::reader::{ReaderTocDrawer, ReaderSettingsDrawer, ReaderViewport};

#[component]
pub fn ReaderPanel() -> impl IntoView {
    let reader_state = use_reader_state();
    let library = use_context::<leptos::RwSignal<Vec<Book>>>().expect("Library context not found");
    
    let active_book_id_signal = reader_state.get_active_book_id();
    let active_chapter_id_signal = reader_state.get_active_chapter_id();
    
    // Get active book and chapter from library
    let active_book = create_memo(move |_| {
        active_book_id_signal.get().and_then(|id| {
            library.get().into_iter().find(|b| b.id == id)
        })
    });
    
    let active_chapter = create_memo(move |_| {
        active_book.get().and_then(|book| {
            active_chapter_id_signal.get().and_then(|id| {
                book.chapters.iter().find(|ch| ch.id == id).cloned()
            })
        })
    });
    
    // Create signals for optional props
    let active_chapter_id_prop = create_memo(move |_| active_chapter_id_signal.get());
    let active_chapter_prop = create_memo(move |_| active_chapter.get());
    
    // Load reader preferences from settings
    let (preferences, set_preferences, update_preferences, _is_hydrated) = crate::hooks::use_reader_preferences::use_persistent_reader_preferences();
    
    let (is_toc_open, set_is_toc_open) = create_signal(false);
    let (is_settings_open, set_is_settings_open) = create_signal(false);
    let (is_immersive, set_is_immersive) = create_signal(false);
    
    let handle_back = Callback::new({
        let reader_state_clone = reader_state.clone();
        let active_book_clone = active_book.clone();
        let active_chapter_clone = active_chapter.clone();
        move |_| {
            // Save progress before navigating away
            // TODO: Call save_progress from reader viewport
            
            // Navigate back to library - clear the active book
            // The app-level navigation will handle switching to library view
            reader_state_clone.set_active_book_id(None);
            reader_state_clone.set_active_chapter_id(None);
            web_sys::console::log_1(&"Navigate to library".into());
        }
    });
    
    let handle_select_chapter = Callback::new({
        let reader_state_clone = reader_state.clone();
        move |chapter_id: String| {
            reader_state_clone.set_active_chapter_id(Some(chapter_id));
        }
    });
    
    let handle_preferences_change = Callback::new({
        let update_prefs = update_preferences.clone();
        move |update: ReaderPreferences| {
            update_prefs.call(update);
        }
    });
    
    view! {
        <section class="flex flex-1 min-h-0 flex-col">
            // Header
            <div
                data-reader-header="true"
                class=move || {
                    let base = "sticky top-0 z-20 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-4 backdrop-blur safe-area-top transition-all duration-300 ease-in-out";
                    if is_immersive.get() {
                        format!("{} pointer-events-none -translate-y-full opacity-0 h-0 overflow-hidden border-transparent py-0", base)
                    } else {
                        format!("{} translate-y-0 opacity-100", base)
                    }
                }
            >
                <div class="flex items-center justify-between gap-2">
                    <Button
                        variant=ButtonVariant::Ghost
                        on_click=handle_back
                        class="px-2"
                    >
                        <ArrowLeft size=16 class="mr-2" />
                        "Library"
                    </Button>
                    <div class="flex items-center gap-2">
                        {move || {
                            if let Some(book) = active_book.get() {
                                view! {
                                    <>
                                        <ReaderTocDrawer
                                            book=book.clone()
                                            active_chapter_id=active_chapter_id_prop.get()
                                            is_open=is_toc_open
                                            on_open_change=Callback::new(move |open: bool| {
                                                if open {
                                                    set_is_immersive.set(false);
                                                }
                                                set_is_toc_open.set(open);
                                            })
                                            on_select_chapter=handle_select_chapter.clone()
                                        />
                                        <Button
                                            variant=ButtonVariant::Outline
                                            size=crate::components::ui::ButtonSize::Icon
                                            on_click=Callback::new(move |_| {
                                                set_is_immersive.set(false);
                                                set_is_settings_open.set(true);
                                            })
                                        >
                                            <crate::components::icons::Settings2 size=16 />
                                        </Button>
                                        <ReaderSettingsDrawer
                                            preferences=preferences.get()
                                            on_preferences_change=handle_preferences_change.clone()
                                            is_open=is_settings_open
                                            on_open_change=Callback::new(move |open: bool| {
                                                if open {
                                                    set_is_immersive.set(false);
                                                }
                                                set_is_settings_open.set(open);
                                            })
                                        />
                                    </>
                                }.into_view()
                            } else {
                                view! {}.into_view()
                            }
                        }}
                    </div>
                </div>
                <div class="flex flex-col gap-1">
                    <h2 class="text-lg font-semibold transition-all duration-200 ease-in-out">
                        {move || {
                            active_chapter.get()
                                .map(|ch| ch.title.clone())
                                .unwrap_or_else(|| "Select a chapter".to_string())
                        }}
                    </h2>
                    <p class="text-sm text-muted-foreground transition-all duration-200 ease-in-out">
                        {move || {
                            if let Some(book) = active_book.get() {
                                format!("{} · {}", book.title, book.author)
                            } else {
                                "Once you import an EPUB, choose a chapter to begin.".to_string()
                            }
                        }}
                    </p>
                </div>
            </div>
            
            // Reader viewport
            <div class="flex flex-1 overflow-hidden min-h-0">
                {move || {
                    if let Some(book) = active_book.get() {
                        view! {
                            <ReaderViewport
                                active_book=book.clone()
                                active_chapter=active_chapter_prop.get()
                                preferences=preferences.get()
                                _on_select_chapter=Some(handle_select_chapter.clone())
                            />
                        }.into_view()
                    } else {
                        view! {
                            <div class="flex flex-1 items-center justify-center">
                                <p class="text-muted-foreground">"No book selected"</p>
                            </div>
                        }.into_view()
                    }
                }}
            </div>
        </section>
    }
}


