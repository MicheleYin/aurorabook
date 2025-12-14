use leptos::*;
use crate::types::reader::Book;
use crate::services::book_service::read_all_books;
use leptos::spawn_local;

/// Hook for managing the library of books
/// Returns: (library, is_loading, refresh_library)
pub fn use_library() -> (
    RwSignal<Vec<Book>>,
    ReadSignal<bool>,
    Callback<()>,
) {
    let library = create_rw_signal(Vec::<Book>::new());
    let (is_loading, set_is_loading) = create_signal(false);
    let (has_loaded, set_has_loaded) = create_signal(false);
    
    // Refresh function to load books from backend
    let refresh_library = Callback::new({
        let library = library.clone();
        let set_is_loading = set_is_loading.clone();
        move |_| {
            set_is_loading.set(true);
            let library_clone = library.clone();
            let set_is_loading_clone = set_is_loading.clone();
            let set_has_loaded_clone = set_has_loaded.clone();
            spawn_local(async move {
                match read_all_books(None).await {
                    Ok(books) => {
                        library_clone.set(books);
                        set_is_loading_clone.set(false);
                        set_has_loaded_clone.set(true);
                    }
                    Err(e) => {
                        web_sys::console::warn_1(&format!("[LibraryHook]: failed to load books: {}", e).into());
                        set_is_loading_clone.set(false);
                        set_has_loaded_clone.set(true);
                    }
                }
            });
        }
    });
    
    // Load books on mount (only once)
    create_effect(move |_| {
        if !has_loaded.get_untracked() && !is_loading.get_untracked() {
            refresh_library.call(());
        }
    });
    
    (library, is_loading, refresh_library)
}
