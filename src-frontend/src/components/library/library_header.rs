use leptos::*;
use crate::components::library::types::{LibraryFilterOption, LibraryViewMode};
use crate::components::icons::{LayoutGrid, List};

#[component]
pub fn LibraryHeader(
    total_books: usize,
    filtered_count: usize,
    is_searching: bool,
    active_filter: ReadSignal<LibraryFilterOption>,
    on_filter_change: Callback<LibraryFilterOption>,
    view_mode: ReadSignal<LibraryViewMode>,
    on_view_mode_change: Callback<LibraryViewMode>,
    action_slot: Option<View>,
) -> impl IntoView {
    let show_count = move || if is_searching { filtered_count } else { total_books };

    view! {
        <div class="sticky top-0 z-20 flex flex-col gap-4 border-b border-border bg-background/95 -mx-4 -mt-6 px-4 pt-6 pb-4 backdrop-blur safe-area-top">
            <div class="flex flex-col gap-3">
                {if let Some(actions) = action_slot {
                    view! {
                        <div class="sm:ml-auto">{actions}</div>
                    }.into_view()
                } else {
                    view! {}.into_view()
                }}
                <div class="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                    {LibraryFilterOption::ALL.iter().map(move |option| {
                        let option_clone = *option;
                        let active_filter_signal = active_filter;
                        let on_change = on_filter_change.clone();
                        view! {
                            <button
                                type="button"
                                on:click=move |_| on_change.call(option_clone)
                                class=move || {
                                    let is_active = option_clone == active_filter_signal.get();
                                    if is_active {
                                        "rounded-full border px-3 py-1 border-primary bg-primary/5 text-primary transition-colors"
                                    } else {
                                        "rounded-full border px-3 py-1 border-border hover:bg-muted transition-colors"
                                    }
                                }
                                aria-pressed=move || {
                                    let is_active = option_clone == active_filter_signal.get();
                                    if is_active { Some("true") } else { None }
                                }
                                aria-label=move || {
                                    let label = option.label();
                                    format!("Filter by {}", label)
                                }
                            >
                                {move || option.label()}
                            </button>
                        }
                    }).collect::<Vec<_>>()}
                    
                    <div class="ml-auto flex items-center gap-1 text-muted-foreground">
                        {LibraryViewMode::ALL.iter().map(move |mode| {
                            let mode_clone = *mode;
                            let view_mode_signal = view_mode;
                            let on_change = on_view_mode_change.clone();
                            view! {
                                <button
                                    type="button"
                                    on:click=move |_| on_change.call(mode_clone)
                                    class=move || {
                                        let is_active = mode_clone == view_mode_signal.get();
                                        if is_active {
                                            "flex items-center justify-center rounded-md border px-2 py-1 text-muted-foreground border-primary bg-primary/5 text-primary transition-colors"
                                        } else {
                                            "flex items-center justify-center rounded-md border px-2 py-1 text-muted-foreground border-border hover:bg-muted transition-colors"
                                        }
                                    }
                                    aria-pressed=move || {
                                        let is_active = mode_clone == view_mode_signal.get();
                                        if is_active { Some("true") } else { None }
                                    }
                                    aria-label=match mode {
                                        LibraryViewMode::Grid => "Switch to grid view",
                                        LibraryViewMode::List => "Switch to list view",
                                    }
                                >
                                    {match mode {
                                        LibraryViewMode::Grid => view! { <LayoutGrid size=16 /> },
                                        LibraryViewMode::List => view! { <List size=16 /> },
                                    }}
                                    <span class="sr-only">
                                        {match mode {
                                            LibraryViewMode::Grid => "Grid view",
                                            LibraryViewMode::List => "List view",
                                        }}
                                    </span>
                                </button>
                            }
                        }).collect::<Vec<_>>()}
                    </div>
                </div>
            </div>
            <p class="text-sm text-muted-foreground">
                {move || {
                    let count = show_count();
                    if total_books == 0 {
                        "Import EPUB files to start building your shelf.".to_string()
                    } else if is_searching {
                        format!("{} result{} for your search.", count, if count == 1 { "" } else { "s" })
                    } else {
                        format!("{} book{} in your library.", count, if count == 1 { "" } else { "s" })
                    }
                }}
            </p>
        </div>
    }
}
