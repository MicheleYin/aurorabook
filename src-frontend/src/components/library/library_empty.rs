use leptos::*;
use crate::components::library::types::LibraryFilterOption;

#[component]
pub fn LibraryEmpty(
    is_searching: bool,
    active_filter: LibraryFilterOption,
) -> impl IntoView {
    let (title, description) = if is_searching {
        (
            "No books match your search.",
            "Try refining your keywords or search by author.",
        )
    } else if active_filter != LibraryFilterOption::All {
        match active_filter {
            LibraryFilterOption::New => (
                "No new books right now.",
                "Import a book or clear your progress to see it here.",
            ),
            LibraryFilterOption::Resume => (
                "Nothing to resume.",
                "Start reading a book and your in-progress titles show up here.",
            ),
            LibraryFilterOption::Finished => (
                "No finished books yet.",
                "Finish a book to celebrate it in this view.",
            ),
            LibraryFilterOption::Recent => (
                "No recent imports.",
                "Add more books to see them here.",
            ),
            LibraryFilterOption::Author => (
                "No books found for this author.",
                "Try another author filter or search by name.",
            ),
            LibraryFilterOption::All => unreachable!(),
        }
    } else {
        (
            "Your shelf is empty.",
            "Import an EPUB to start reading.",
        )
    };

    view! {
        <div
            class="rounded-md border border-dashed p-8 text-center animate-in fade-in-0 slide-in-from-bottom-4 duration-300 ease-out"
        >
            <p class="text-sm font-medium">{title}</p>
            <p class="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
    }
}
