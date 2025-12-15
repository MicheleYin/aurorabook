use leptos::*;
use crate::types::reader::Book;
use crate::components::ui::{Progress, Button, ButtonVariant, ButtonSize};
use crate::components::library::utils::{get_book_progress_summary, get_library_book_status_from_summary};
use crate::components::library::LibraryStatusBadge;
use crate::components::icons::{ImageOff, Loader2};
use crate::hooks::use_conversion::use_conversion;
use wasm_bindgen::JsCast;

#[component]
pub fn LibraryGrid(
    books: Vec<Book>,
    active_book_id: Option<String>,
    on_open_book: Callback<String>,
    on_view_details: Option<Callback<String>>,
) -> impl IntoView {
    let conversion = use_conversion();
    let conversion_progress_signal = conversion.get_progress_signal();
    view! {
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:flex 2xl:flex-wrap library-grid-transition">
            {books.into_iter().enumerate().map(move |(index, book)| {
                // Calculate stagger delay for animation (30ms per item)
                let delay_ms = index * 30;
                let stagger_class = format!("[animation-delay:{}ms]", delay_ms);
                let stagger_class_clone = stagger_class.clone();
                let book_id = book.id.clone();
                let is_active = active_book_id.as_ref().map(|id| id == &book.id).unwrap_or(false);
                let progress_summary = get_book_progress_summary(&book);
                let status = get_library_book_status_from_summary(&progress_summary);
                let has_chapters = !book.chapters.is_empty();
                let progress_text = if has_chapters {
                    format!("Progress: {}", progress_summary.label)
                } else {
                    "Progress: No chapters available".to_string()
                };
                let chapter_summary = if has_chapters {
                    format!("Chapters: {}", book.chapters.len())
                } else {
                    "Chapters: Not available".to_string()
                };
                let chapter_summary_for_bottom = chapter_summary.clone();
                let book_title = book.title.clone();
                let book_author = book.author.clone();
                let book_cover_url = book.cover_url.clone();
                let book_progress = book.progress.clone();
                let on_open = on_open_book.clone();
                let book_id_for_progress = book_id.clone();
                let conversion_signal_clone = conversion_progress_signal.clone();
                
                view! {
                    <div
                        class=move || {
                            let base_classes = format!("library-item-enter {} group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 2xl:w-[200px]", stagger_class_clone);
                            if is_active {
                                format!("{} border-primary shadow-md ring-1 ring-primary/40", base_classes)
                            } else {
                                base_classes
                            }
                        }
                        on:click={
                            let id = book_id.clone();
                            move |ev| {
                                // Don't open book if clicking on Details button
                                if let Some(target) = ev.target() {
                                    if let Ok(button) = target.dyn_into::<web_sys::HtmlButtonElement>() {
                                        // Clicked on a button, don't open the book
                                        return;
                                    }
                                }
                                on_open.call(id.clone());
                            }
                        }
                        on:keydown={
                            let id = book_id.clone();
                            move |ev| {
                                let key = ev.key();
                                if key == "Enter" || key == " " {
                                    ev.prevent_default();
                                    on_open.call(id.clone());
                                }
                            }
                        }
                        tabindex="0"
                        role="button"
                        aria-label={
                            let title = book_title.clone();
                            let author = book_author.clone();
                            move || format!("Open {} by {}", title.clone(), author.clone())
                        }
                    >
                        <div class="relative aspect-[3/4] w-full max-w-full overflow-hidden bg-muted">
                            <div class="absolute left-2 top-2 z-10">
                                <LibraryStatusBadge status=status />
                            </div>
                            {if let Some(cover_url) = book_cover_url {
                                let cover_alt = format!("{} cover", book_title);
                                view! {
                                    <img
                                        src=cover_url
                                        alt=cover_alt
                                        class="h-full w-full max-h-full max-w-full object-cover transition-transform duration-300 ease-out group-hover:scale-110"
                                        loading="lazy"
                                    />
                                }.into_view()
                            } else {
                                view! {
                                    <div class="flex h-full w-full items-center justify-center text-muted-foreground">
                                        <ImageOff size=40 />
                                    </div>
                                }.into_view()
                            }}
                        </div>
                        <div class="flex flex-1 flex-col gap-2 p-4">
                            <div>
                                <p class="line-clamp-1 text-sm font-semibold text-foreground">
                                    {book_title.clone()}
                                </p>
                                <p class="line-clamp-1 text-xs text-muted-foreground">
                                    {book_author.clone()}
                                </p>
                            </div>
                            {
                                let chapter_summary_for_closure = chapter_summary.clone();
                                let conversion_signal_for_closure = conversion_signal_clone.clone();
                                let book_id_for_closure = book_id_for_progress.clone();
                                let has_chapters_for_closure = has_chapters;
                                let book_progress_for_closure = book_progress.clone();
                                let progress_text_for_closure = progress_text.clone();
                                move || {
                                // Check for conversion progress first - make it reactive
                                let conversion_progress = conversion_signal_for_closure.get().get(&book_id_for_closure).cloned();
                                if let Some(conv_progress) = conversion_progress {
                                    let percent = if conv_progress.total_words > 0 {
                                        ((conv_progress.words_processed as f64 / conv_progress.total_words as f64) * 100.0).min(100.0).max(0.0)
                                    } else if conv_progress.total_chapters > 0 {
                                        ((conv_progress.current_chapter as f64 / conv_progress.total_chapters as f64) * 100.0).min(100.0).max(0.0)
                                    } else {
                                        0.0
                                    };
                                    
                                    let progress_msg = if conv_progress.total_words > 0 {
                                        format!("Converting: {}% - {}", percent.round() as u32, conv_progress.message)
                                    } else {
                                        format!("Converting: {}% - {}", percent.round() as u32, conv_progress.message)
                                    };
                                    
                                    view! {
                                        <div class="space-y-1">
                                            <Progress value=percent max=100.0 class="h-1" />
                                            <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <Loader2 size=10 class="animate-spin" />
                                                <p class="line-clamp-1">{progress_msg}</p>
                                            </div>
                                        </div>
                                    }.into_view()
                                } else if has_chapters_for_closure && book_progress_for_closure.is_some() {
                                    let progress = book_progress_for_closure.as_ref().unwrap();
                                    let _percent = progress.book_progress_percent * 100.0;
                                    let progress_text_clone = progress_text_for_closure.clone();
                                    view! {
                                        <p class="text-xs text-muted-foreground">{progress_text_clone}</p>
                                    }.into_view()
                                } else {
                                    let chapter_summary_display = chapter_summary_for_closure.clone();
                                    view! {
                                        <p class="text-xs text-muted-foreground">{chapter_summary_display}</p>
                                    }.into_view()
                                }
                            }}
                            <div class="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                                <div class="flex flex-col">
                                    <span>{chapter_summary_for_bottom.clone()}</span>
                                </div>
                                {if let Some(on_view_details) = on_view_details {
                                    let book_id_for_details = book_id.clone();
                                    let on_view = on_view_details.clone();
                                    view! {
                                        <Button
                                            variant=ButtonVariant::Ghost
                                            size=ButtonSize::Sm
                                            on_click=Callback::new(move |_ev: ()| {
                                                // Note: Button's on_click doesn't provide event, so we handle stopPropagation in the card's click handler
                                                on_view.call(book_id_for_details.clone());
                                            })
                                            class="shrink-0"
                                        >
                                            {move || "Details"}
                                        </Button>
                                    }.into_view()
                                } else {
                                    view! {}.into_view()
                                }}
                            </div>
                        </div>
                    </div>
                }
            }).collect::<Vec<_>>()}
        </div>
    }
}
