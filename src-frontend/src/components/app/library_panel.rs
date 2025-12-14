use leptos::*;
use crate::types::reader::Book;
use crate::components::library::*;
use crate::components::ui::Button;
use crate::components::icons::{Plus, Loader2};
use crate::components::ui::ButtonVariant;

#[component]
pub fn LibraryPanel() -> impl IntoView {
    // State for library management
    let (library, set_library) = create_signal(Vec::<Book>::new());
    let (search_term, set_search_term) = create_signal(String::new());
    let (active_filter, set_active_filter) = create_signal(LibraryFilterOption::All);
    let (view_mode, set_view_mode) = create_signal(LibraryViewMode::Grid);
    let (is_importing, set_is_importing) = create_signal(false);
    let (active_book_id, set_active_book_id) = create_signal(None::<String>);

    // Filter and search the library
    let filtered_books = create_memo(move |_| {
        let books = library.get();
        filter_library(&books, active_filter.get(), &search_term.get())
    });

    let is_searching = create_memo(move |_| !search_term.get().trim().is_empty());
    let has_books = create_memo(move |_| !filtered_books.get().is_empty());
    let total_books = create_memo(move |_| library.get().len());

    // Handlers
    let handle_search_change = Callback::new(move |value: String| {
        set_search_term.set(value);
    });

    let handle_filter_change = Callback::new(move |filter: LibraryFilterOption| {
        set_active_filter.set(filter);
    });

    let handle_view_mode_change = Callback::new(move |mode: LibraryViewMode| {
        set_view_mode.set(mode);
    });

    let handle_add_ebook = Callback::new(move |_| {
        // TODO: Implement ebook import
        web_sys::console::log_1(&"Add ebook clicked".into());
    });

    let handle_open_book = Callback::new(move |book_id: String| {
        let id = book_id.clone();
        set_active_book_id.set(Some(book_id));
        // TODO: Navigate to reader or open book details
        web_sys::console::log_1(&format!("Open book: {}", id).into());
    });


    view! {
        <div class="flex h-full flex-col">
            <LibraryHeader
                total_books=total_books.get()
                filtered_count=filtered_books.get().len()
                is_searching=is_searching.get()
                active_filter=active_filter
                on_filter_change=handle_filter_change
                view_mode=view_mode
                on_view_mode_change=handle_view_mode_change
                action_slot={
                    let is_importing_clone = is_importing.clone();
                    let handle_add_clone = handle_add_ebook.clone();
                    Some({
                        let is_importing_for_view = is_importing_clone.clone();
                        let handle_add_for_view = handle_add_clone.clone();
                        view! {
                            <div class="sm:ml-auto">
                                <Button
                                    variant=ButtonVariant::Default
                                    on_click=Callback::new(move |_| handle_add_for_view.call(()))
                                    disabled=is_importing_for_view.get_untracked()
                                    class="w-full sm:w-auto"
                                >
                                    {move || {
                                        if is_importing_for_view.get_untracked() {
                                            view! {
                                                <Loader2 size=16 class="mr-2 animate-spin" />
                                                <span>"Adding…"</span>
                                            }.into_view()
                                        } else {
                                            view! {
                                                <Plus size=16 class="mr-2" />
                                                <span>"Add ebook"</span>
                                            }.into_view()
                                        }
                                    }}
                                </Button>
                            </div>
                        }.into_view()
                    })
                }
            />

            <div class="pt-6">
                <LibrarySearchBar
                    value=search_term.get()
                    on_change=handle_search_change
                    disabled=is_importing.get()
                />
            </div>

            <div class="flex-1 pt-6">
                {move || {
                    if has_books.get() {
                        match view_mode.get() {
                            LibraryViewMode::Grid => {
                                let books = filtered_books.get();
                                let active_id = active_book_id.get();
                                let on_open = handle_open_book.clone();
                                view! {
                                    <LibraryGrid
                                        books=books
                                        active_book_id=active_id
                                        on_open_book=on_open
                                    />
                                }.into_view()
                            },
                            LibraryViewMode::List => {
                                let books = filtered_books.get();
                                let active_id = active_book_id.get();
                                let on_open = handle_open_book.clone();
                                view! {
                                    <LibraryList
                                        books=books
                                        active_book_id=active_id
                                        on_open_book=on_open
                                    />
                                }.into_view()
                            },
                        }
                    } else {
                        view! {
                            <LibraryEmpty
                                is_searching=is_searching.get()
                                active_filter=active_filter.get()
                            />
                        }.into_view()
                    }
                }}
            </div>

            <div class="pb-10"></div>
        </div>
    }
}
