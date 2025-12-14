use leptos::*;
use crate::types::reader::Book;
use crate::components::ui::{Progress, Separator};
use crate::components::library::utils::{get_book_progress_summary, get_library_book_status_from_summary};
use crate::components::library::LibraryStatusBadge;
use crate::components::icons::ImageOff;

#[component]
pub fn LibraryList(
    books: Vec<Book>,
    active_book_id: Option<String>,
    on_open_book: Callback<String>,
    #[prop(optional)] on_view_details: Option<Callback<String>>,
) -> impl IntoView {
    let books_len = books.len();
    view! {
        <div class="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
            {books.into_iter().enumerate().map(move |(index, book)| {
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
                let book_title = book.title.clone();
                let book_author = book.author.clone();
                let book_cover_url = book.cover_url.clone();
                let book_progress = book.progress.clone();
                let on_open = on_open_book.clone();
                let idx = index;
                let len = books_len;
                
                view! {
                    <>
                        <div
                            class=move || {
                                format!(
                                    "flex items-center gap-4 p-4 cursor-pointer transition-colors hover:bg-muted/50 {}",
                                    if is_active { "bg-primary/5" } else { "" }
                                )
                            }
                            on:click={
                                let id = book_id.clone();
                                move |_| {
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
                            <div class="relative h-20 w-16 shrink-0 overflow-hidden rounded bg-muted">
                                {if let Some(cover_url) = book_cover_url {
                                    let cover_alt = book_title.clone();
                                    view! {
                                        <img
                                            src=cover_url
                                            alt=format!("Cover for {}", cover_alt)
                                            class="h-full w-full object-cover"
                                            loading="lazy"
                                        />
                                    }.into_view()
                                } else {
                                    view! {
                                        <div class="flex h-full w-full items-center justify-center">
                                            <ImageOff size=32 class="text-muted-foreground/50" />
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
                                {if has_chapters && book_progress.is_some() {
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
                                    let chapter_summary_clone = chapter_summary.clone();
                                    view! {
                                        <p class="text-xs text-muted-foreground">{chapter_summary_clone}</p>
                                    }.into_view()
                                }}
                            </div>
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
