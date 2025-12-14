use leptos::*;
use leptos_meta::*;
use crate::components::app::*;

#[derive(Clone, Copy, PartialEq)]
enum ActiveView {
    Library,
    Reader,
    Settings,
}

#[component]
pub fn App() -> impl IntoView {
    provide_meta_context();
    
    let (active_view, set_active_view) = create_signal(ActiveView::Library);
    
    // Navigation items configuration
    let nav_items = vec![
        ("library", "Library", ActiveView::Library, false),
        ("reader", "Reader", ActiveView::Reader, false),
        ("settings", "Settings", ActiveView::Settings, false),
    ];
    
    // Determine current view content
    let current_view = move || {
        match active_view.get() {
            ActiveView::Library => view! { <LibraryPanel /> }.into_view(),
            ActiveView::Reader => view! { <ReaderPanel /> }.into_view(),
            ActiveView::Settings => view! { <SettingsPanel /> }.into_view(),
        }
    };
    
    view! {
        <div class="flex min-h-screen flex-col bg-background text-foreground">
            <div class="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
                <div class="flex flex-1 min-h-0 flex-col">
                    {current_view}
                </div>
            </div>
            
            // Bottom Navigation Bar
            <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6">
                <div class="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-lg ring-1 ring-black/5 backdrop-blur-xl transition-[backdrop-filter] duration-300 ease-in-out">
                    {nav_items.into_iter().map(move |(_id, label, view, disabled)| {
                        let is_active = move || active_view.get() == view;
                        let view_clone = view;
                        let set_view = set_active_view.clone();
                        let is_disabled = disabled;
                        
                        view! {
                            <button
                                type="button"
                                disabled=is_disabled
                                on:click=move |_| {
                                    if !is_disabled {
                                        set_view.set(view_clone);
                                    }
                                }
                                class=move || {
                                    let base = "rounded-full px-4 py-1.5 text-sm font-medium transition-colors";
                                    if is_active() {
                                        format!("{} bg-primary text-primary-foreground shadow-sm", base)
                                    } else if is_disabled {
                                        format!("{} cursor-not-allowed opacity-50 hover:bg-transparent text-muted-foreground", base)
                                    } else {
                                        format!("{} text-muted-foreground hover:bg-muted", base)
                                    }
                                }
                                title=move || {
                                    if is_disabled && view == ActiveView::Reader {
                                        Some("Open a book to enter the reader")
                                    } else {
                                        None
                                    }
                                }
                                aria-label=move || {
                                    if is_disabled && view == ActiveView::Reader {
                                        "Open a book to enter the reader".to_string()
                                    } else {
                                        format!("Navigate to {}", label)
                                    }
                                }
                                aria-current=move || if is_active() { Some("page") } else { None }
                            >
                                {label}
                            </button>
                        }
                    }).collect::<Vec<_>>()}
                </div>
            </div>
        </div>
    }
}
