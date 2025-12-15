use leptos::*;
use crate::types::reader::Book;
use crate::components::ui::{Progress, Separator, Button, ButtonVariant, ButtonSize};
use crate::components::library::utils::{get_book_progress_summary, get_library_book_status_from_summary};
use crate::components::library::LibraryStatusBadge;
use crate::components::icons::{ImageOff, Loader2};
use crate::hooks::use_conversion::use_conversion;
use wasm_bindgen::JsCast;

#[component]
pub fn LibraryList(
    books: Vec<Book>,
    active_book_id: Option<String>,
    on_open_book: Callback<String>,
    on_view_details: Option<Callback<String>>,
) -> impl IntoView {
    let conversion = use_conversion();
    let conversion_progress_signal = conversion.get_progress_signal();
    let books_len = books.len();
    view! {
        <div class="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
            {books.into_iter().enumerate().map(move |(index, book)| {
                // Calculate stagger delay for animation (20ms per item for list view)
                let delay_ms = index * 20;
                let stagger_class = format!("[animation-delay:{}ms]", delay_ms);
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
                let chapter_summary_for_progress = chapter_summary.clone();
                let book_title = book.title.clone();
                let book_author = book.author.clone();
                let book_cover_url = book.cover_url.clone();
                let book_progress = book.progress.clone();
                let on_open = on_open_book.clone();
                let book_id_for_progress = book_id.clone();
                let conversion_signal_clone = conversion_progress_signal.clone();
                let idx = index;
                let len = books_len;
                
                view! {
                    <>
                        <div
                            class=move || {
                                let base_classes = format!("library-item-enter {} flex items-center gap-4 p-4 cursor-pointer transition-colors hover:bg-muted/50", stagger_class);
                                if is_active {
                                    format!("{} bg-primary/5", base_classes)
                                } else {
                                    base_classes
                                }
                            }
                            on:click={
                                let id = book_id.clone();
                                move |ev| {
                                    // Don't open book if clicking on Details button
                                    if let Some(target) = ev.target() {
                                        if target.dyn_into::<web_sys::HtmlButtonElement>().is_ok() {
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
                            <div class="relative h-16 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                                {if let Some(cover_url) = book_cover_url {
                                    let cover_alt = book_title.clone();
                                    view! {
                                        <img
                                            src=cover_url
                                            alt=format!("Cover for {}", cover_alt)
                                            class="h-full w-full max-h-full max-w-full object-cover"
                                            loading="lazy"
                                        />
                                    }.into_view()
                                } else {
                                    view! {
                                        <div class="flex h-full w-full items-center justify-center text-muted-foreground">
                                            <ImageOff size=24 class="h-6 w-6" />
                                        </div>
                                    }.into_view()
                                }}
                                <div class="absolute top-1 right-1">
                                    <LibraryStatusBadge status=status />
                                </div>
                            </div>
                            <div class="flex-1 min-w-0 space-y-2">
                                <div>
                                    <h3 class="font-semibold text-base line-clamp-1">
                                        {book_title.clone()}
                                    </h3>
                                    <p class="text-sm text-muted-foreground line-clamp-1">
                                        {book_author.clone()}
                                    </p>
                                </div>
                                {move || {
                                    // Check for conversion progress first - make it reactive
                                    let conversion_progress = conversion_signal_clone.get().get(&book_id_for_progress).cloned();
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
                                    } else if has_chapters && book_progress.is_some() {
                                        let progress = book_progress.as_ref().unwrap();
                                        let percent = progress.book_progress_percent * 100.0;
                                        let progress_text_clone = progress_text.clone();
                                        view! {
                                            <div class="space-y-1">
                                                <Progress value=percent class="h-1" />
                                                <p class="text-xs text-muted-foreground">{progress_text_clone}</p>
                                            </div>
                                        }.into_view()
                                    } else {
                                        view! {
                                            <p class="text-xs text-muted-foreground">{chapter_summary_for_progress.clone()}</p>
                                        }.into_view()
                                    }
                                }}
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
                                    >
                                        {move || "Details"}
                                    </Button>
                                }.into_view()
                            } else {
                                view! {}.into_view()
                            }}
                        </div>
                        {move || {
                            if idx < len.saturating_sub(1) {
                                view! { <Separator /> }.into_view()
                            } else {
                                view! {}.into_view()
                            }
                        }}
                    </>
                }
            }).collect::<Vec<_>>()}
        </div>
    }
}
