use leptos::*;
use crate::types::reader::Book;
use crate::components::library::*;
use crate::components::ui::Button;
use crate::components::icons::{Plus, Loader2};
use crate::components::ui::ButtonVariant;
use crate::hooks::use_toast::use_toast;
use crate::hooks::use_conversion::use_conversion;
use crate::services::{open_file_dialog, save_file_dialog};
use crate::services::book_service::{delete_book, export_epub_to_file, ingest_epub};
use crate::types::reader::VoiceId;
use leptos::spawn_local;

#[component]
pub fn LibraryPanel() -> impl IntoView {
    // Get library from app-level context
    let library = use_context::<RwSignal<Vec<Book>>>().expect("Library context not found");
    let is_loading_library = use_context::<ReadSignal<bool>>().expect("IsLoadingLibrary context not found");
    let refresh_library = use_context::<Callback<()>>().expect("RefreshLibrary context not found");
    let toast = use_toast();
    let conversion = use_conversion();
    
    // Get reader state (LibraryPanel is rendered inside ReaderStateProvider)
    let reader_state = crate::hooks::use_reader_state::use_reader_state();
    
    // State for library management
    let (search_term, set_search_term) = create_signal(String::new());
    let (active_filter, set_active_filter) = create_signal(LibraryFilterOption::All);
    let (view_mode, set_view_mode) = create_signal(LibraryViewMode::Grid);
    let (is_importing, set_is_importing) = create_signal(false);
    let (deleting_book_id, set_deleting_book_id) = create_signal::<Option<String>>(None);
    let (active_book_id, set_active_book_id) = create_signal(None::<String>);
    let (detail_book_id, set_detail_book_id) = create_signal(None::<String>);

    // Filter and search the library
    let filtered_books = create_memo(move |_| {
        let books = library.get();
        filter_library(&books, active_filter.get(), &search_term.get())
    });
    
    // Show loading state while library is being loaded initially
    let show_loading = create_memo(move |_| is_loading_library.get() && library.get().is_empty());

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

    let handle_add_ebook = Callback::new({
        let set_is_importing = set_is_importing.clone();
        let is_importing_signal = is_importing.clone();
        let refresh_library_cb = refresh_library.clone();
        let library_signal = library.clone();
        let toast_clone = toast.clone();
        move |_| {
            if is_importing_signal.get_untracked() {
                return;
            }
            
            set_is_importing.set(true);
            
            let set_is_importing_clone = set_is_importing.clone();
            let refresh_library_clone = refresh_library_cb.clone();
            let library_clone = library_signal.clone();
            let toast_for_async = toast_clone.clone();
            
            spawn_local(async move {
                // Open file dialog
                match open_file_dialog().await {
                    Ok(Some(file_path)) => {
                        // Validate file extension
                        if !file_path.to_lowercase().ends_with(".epub") {
                            toast_for_async.error(
                                "Invalid file type".to_string(),
                                Some("Please choose an EPUB (.epub) file.".to_string())
                            );
                            set_is_importing_clone.set(false);
                            return;
                        }
                        
                        // Ingest the EPUB
                        match ingest_epub(&file_path, &file_path).await {
                            Ok(book) => {
                                web_sys::console::log_1(&format!("Successfully imported book: {}", book.title).into());
                                
                                // Refresh library to get the new book
                                refresh_library_clone.call(());
                                
                                // Show success toast
                                toast_for_async.success(
                                    "EPUB imported successfully".to_string(),
                                    Some(format!("\"{}\" has been added to your library.", book.title))
                                );
                                
                                set_is_importing_clone.set(false);
                            }
                            Err(e) => {
                                web_sys::console::error_1(&format!("Failed to import EPUB: {}", e).into());
                                
                                // Check if it's a duplicate error
                                let error_lower = e.to_lowercase();
                                let error_message = e.clone();
                                
                                if error_lower.contains("duplicate book") || error_lower.contains("already in your library") {
                                    // Extract book title from error message if present
                                    // Error format: "Duplicate book: This EPUB is already in your library: \"{title}\""
                                    let description = if let Some(start_pos) = error_message.find("This EPUB is already in your library: \"") {
                                        let remaining = &error_message[start_pos + "This EPUB is already in your library: \"".len()..];
                                        if let Some(end_pos) = remaining.find('"') {
                                            let title = &remaining[..end_pos];
                                            Some(format!("\"{}\" is already in your library.", title))
                                        } else {
                                            Some("This EPUB is already in your library.".to_string())
                                        }
                                    } else {
                                        Some("This EPUB is already in your library.".to_string())
                                    };
                                    
                                    toast_for_async.warning(
                                        "Duplicate EPUB detected".to_string(),
                                        description
                                    );
                                } else {
                                    toast_for_async.error(
                                        "Import failed".to_string(),
                                        Some(error_message)
                                    );
                                }
                                
                                set_is_importing_clone.set(false);
                            }
                        }
                    }
                    Ok(None) => {
                        // User cancelled
                        set_is_importing_clone.set(false);
                    }
                    Err(e) => {
                        web_sys::console::error_1(&format!("Failed to open file dialog: {}", e).into());
                        set_is_importing_clone.set(false);
                    }
                }
            });
        }
    });

    let handle_open_book = Callback::new({
        let reader_state_clone = reader_state.clone();
        let library_clone = library.clone();
        move |book_id: String| {
            // Set active book in reader state
            reader_state_clone.set_active_book_id(Some(book_id.clone()));
            
            // Find the book to get its chapters
            let book = library_clone.get().into_iter().find(|b| b.id == book_id);
            if let Some(book) = book {
                // Get valid chapter ID from progress or fallback to first chapter
                let chapter_id = book.progress.as_ref()
                    .and_then(|p| {
                        // Try to find chapter by saved chapter ID
                        book.chapters.iter()
                            .find(|ch| ch.id == p.current_chapter_id)
                            .map(|ch| ch.id.clone())
                    })
                    .or_else(|| {
                        // Try by index
                        book.progress.as_ref()
                            .and_then(|p| book.chapters.get(p.current_chapter_index))
                            .map(|ch| ch.id.clone())
                    })
                    .or_else(|| {
                        // Fallback to first chapter
                        book.chapters.first().map(|ch| ch.id.clone())
                    });
                
                if let Some(ch_id) = chapter_id {
                    reader_state_clone.set_active_chapter_id(Some(ch_id));
                }
            }
            
            // Navigation to reader will happen automatically via app-level effect
            web_sys::console::log_1(&format!("Open book: {}", book_id).into());
        }
    });

    let handle_view_details = Callback::new(move |book_id: String| {
        set_detail_book_id.set(Some(book_id));
    });
    
    // Get the detail book from library
    let detail_book = create_memo(move |_| {
        let detail_id = detail_book_id.get();
        if let Some(id) = detail_id {
            library.get().into_iter().find(|b| b.id == id)
        } else {
            None
        }
    });
    
    // Dialog/drawer open state
    let (is_detail_open, set_is_detail_open) = create_signal(false);
    
    // Update is_detail_open when detail_book_id changes
    create_effect(move |_| {
        set_is_detail_open.set(detail_book_id.get().is_some());
    });
    
    let handle_close_detail = Callback::new(move |_| {
        set_detail_book_id.set(None);
    });

    let handle_convert_to_audiobook = Callback::new({
        let conversion_clone = conversion.clone();
        let refresh_library_cb = refresh_library.clone();
        move |(book, voice_id): (Book, VoiceId)| {
            let conversion_for_async = conversion_clone.clone();
            let book_for_async = book.clone();
            let refresh_library_async = refresh_library_cb.clone();
            spawn_local(async move {
                if let Err(e) = conversion_for_async.convert_book(book_for_async, voice_id, refresh_library_async).await {
                    web_sys::console::error_1(&format!("Conversion failed: {}", e).into());
                }
            });
        }
    });

    let handle_cancel_conversion = Callback::new({
        let conversion_clone = conversion.clone();
        let library_signal = library.clone();
        move |book_id: String| {
            if let Some(book) = library_signal.get().into_iter().find(|b| b.id == book_id) {
                let conversion_for_async = conversion_clone.clone();
                spawn_local(async move {
                    if let Err(e) = conversion_for_async.cancel_conversion_for_book(&book).await {
                        web_sys::console::error_1(&format!("Failed to cancel conversion: {}", e).into());
                    }
                });
            }
        }
    });

    let handle_export_epub = Callback::new({
        let toast_clone = toast.clone();
        let library_signal = library.clone();
        move |book_id: String| {
            let toast_for_async = toast_clone.clone();
            let library_for_async = library_signal.clone();
            let book_id_clone = book_id.clone();
            
            spawn_local(async move {
                // Find the book to get its title
                let book_opt = library_for_async.get().into_iter().find(|b| b.id == book_id_clone);
                if let Some(book) = book_opt {
                    // Sanitize title for filename
                    let sanitized_title: String = book.title
                        .chars()
                        .map(|c| if c.is_alphanumeric() { c } else { '_' })
                        .collect();
                    let default_path = format!("{}.epub", sanitized_title);
                    
                    // Show save dialog
                    match save_file_dialog(&default_path, Some(vec![("EPUB files", vec!["epub"])])).await {
                        Ok(Some(file_path)) => {
                            // Export the EPUB
                            match export_epub_to_file(&book_id_clone, &file_path).await {
                                Ok(_) => {
                                    // Extract filename from path
                                    let filename = file_path.split('/').last()
                                        .or_else(|| file_path.split('\\').last())
                                        .unwrap_or(&file_path);
                                    
                                    toast_for_async.success(
                                        format!("EPUB exported! Saved to {}", filename),
                                        None
                                    );
                                }
                                Err(e) => {
                                    web_sys::console::error_1(&format!("Failed to export EPUB: {}", e).into());
                                    let error_msg = if e.contains("Could not export") {
                                        e
                                    } else {
                                        format!("Could not export the EPUB file: {}", e)
                                    };
                                    toast_for_async.error(
                                        "Export failed".to_string(),
                                        Some(error_msg)
                                    );
                                }
                            }
                        }
                        Ok(None) => {
                            // User cancelled, do nothing
                        }
                        Err(e) => {
                            web_sys::console::error_1(&format!("Failed to open save dialog: {}", e).into());
                            toast_for_async.error(
                                "Export failed".to_string(),
                                Some("Could not open save dialog.".to_string())
                            );
                        }
                    }
                } else {
                    toast_for_async.error(
                        "Export failed".to_string(),
                        Some("Book not found.".to_string())
                    );
                }
            });
        }
    });

    let handle_delete_book = Callback::new({
        let set_deleting_book_id = set_deleting_book_id.clone();
        let deleting_book_id_signal = deleting_book_id.clone();
        let refresh_library_cb = refresh_library.clone();
        let library_signal = library.clone();
        let set_detail_book_id_clone = set_detail_book_id.clone();
        let toast_clone = toast.clone();
        move |book_id: String| {
            if deleting_book_id_signal.get_untracked().is_some() {
                return;
            }
            
            set_deleting_book_id.set(Some(book_id.clone()));
            
            let set_deleting_clone = set_deleting_book_id.clone();
            let refresh_library_clone = refresh_library_cb.clone();
            let library_clone = library_signal.clone();
            let set_detail_book_id_async = set_detail_book_id_clone.clone();
            let toast_for_async = toast_clone.clone();
            let book_id_clone = book_id.clone();
            
            spawn_local(async move {
                match delete_book(&book_id_clone).await {
                    Ok(_) => {
                        // Update library state
                        library_clone.update(|books| {
                            books.retain(|b| b.id != book_id_clone);
                        });
                        
                        // Close detail dialog
                        set_detail_book_id_async.set(None);
                        
                        // Refresh library to ensure consistency
                        refresh_library_clone.call(());
                        
                        toast_for_async.success(
                            "Book deleted".to_string(),
                            Some("The book has been removed from your library.".to_string())
                        );
                        
                        set_deleting_clone.set(None);
                    }
                    Err(e) => {
                        web_sys::console::error_1(&format!("Failed to delete book: {}", e).into());
                        toast_for_async.error(
                            "Failed to delete book".to_string(),
                            Some(e)
                        );
                        set_deleting_clone.set(None);
                    }
                }
            });
        }
    });
    
    let handle_open_book_from_detail = Callback::new({
        let reader_state_clone = reader_state.clone();
        let library_clone = library.clone();
        move |book_id: String| {
            set_detail_book_id.set(None);
            
            // Set active book in reader state
            reader_state_clone.set_active_book_id(Some(book_id.clone()));
            
            // Find the book to get its chapters
            let book = library_clone.get().into_iter().find(|b| b.id == book_id);
            if let Some(book) = book {
                // Get valid chapter ID from progress or fallback to first chapter
                let chapter_id = book.progress.as_ref()
                    .and_then(|p| {
                        // Try to find chapter by saved chapter ID
                        book.chapters.iter()
                            .find(|ch| ch.id == p.current_chapter_id)
                            .map(|ch| ch.id.clone())
                    })
                    .or_else(|| {
                        // Try by index
                        book.progress.as_ref()
                            .and_then(|p| book.chapters.get(p.current_chapter_index))
                            .map(|ch| ch.id.clone())
                    })
                    .or_else(|| {
                        // Fallback to first chapter
                        book.chapters.first().map(|ch| ch.id.clone())
                    });
                
                if let Some(ch_id) = chapter_id {
                    reader_state_clone.set_active_chapter_id(Some(ch_id));
                }
            }
            
            // Navigation to reader will happen automatically via app-level effect
            web_sys::console::log_1(&format!("Open book from details: {}", book_id).into());
        }
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
                    let is_importing_signal = is_importing.clone();
                    let handle_add_clone = handle_add_ebook.clone();
                    Some({
                        let is_importing_for_view = is_importing_signal.clone();
                        let handle_add_for_view = handle_add_clone.clone();
                        view! {
                            <div class="sm:ml-auto">
                                <Button
                                    variant=ButtonVariant::Default
                                    on_click=Callback::new(move |_| handle_add_for_view.call(()))
                                    disabled=is_importing_for_view
                                    class="w-full sm:w-auto"
                                >
                                    {move || {
                                        if is_importing_for_view.get() {
                                            view! {
                                                <Loader2 size=16 class="mr-2 animate-spin" />
                                                <span>"Adding�"</span>
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
                    if show_loading.get() {
                        view! {
                            <div class="flex items-center justify-center h-64">
                                <div class="flex flex-col items-center gap-2">
                                    <Loader2 size=32 class="animate-spin text-muted-foreground" />
                                    <p class="text-sm text-muted-foreground">"Loading library..."</p>
                                </div>
                            </div>
                        }.into_view()
                    } else if has_books.get() {
                        match view_mode.get() {
                            LibraryViewMode::Grid => {
                                let books = filtered_books.get();
                                let active_id = active_book_id.get();
                                let on_open = handle_open_book.clone();
                                let on_view_details = handle_view_details.clone();
                                view! {
                                    <LibraryGrid
                                        books=books
                                        active_book_id=active_id
                                        on_open_book=on_open
                                        on_view_details=Some(on_view_details)
                                    />
                                }.into_view()
                            },
                            LibraryViewMode::List => {
                                let books = filtered_books.get();
                                let active_id = active_book_id.get();
                                let on_open = handle_open_book.clone();
                                let on_view_details = handle_view_details.clone();
                                view! {
                                    <LibraryList
                                        books=books
                                        active_book_id=active_id
                                        on_open_book=on_open
                                        on_view_details=Some(on_view_details)
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
            
            // Book Detail Dialog/Drawer
            {move || {
                let detail_book_opt = detail_book.get();
                let detail_book_id_for_signal = detail_book_opt.as_ref().map(|b| b.id.clone());
                let (is_deleting_signal, set_is_deleting) = create_signal(
                    deleting_book_id.get().and_then(|id| detail_book_id_for_signal.as_ref().map(|book_id| book_id == &id)).unwrap_or(false)
                );
                create_effect(move |_| {
                    let current_detail_id = detail_book.get().as_ref().map(|b| b.id.clone());
                    let new_value = deleting_book_id.get().and_then(|id| current_detail_id.as_ref().map(|book_id| book_id == &id)).unwrap_or(false);
                    set_is_deleting.set(new_value);
                });
                if detail_book_opt.is_some() {
                    let on_open = handle_open_book_from_detail.clone();
                    let on_delete = handle_delete_book.clone();
                    view! {
                        <BookDetailDialog
                            book=detail_book_opt
                            open=is_detail_open
                            on_close=handle_close_detail
                            on_open_book=Some(on_open)
                            on_delete_book=Some(on_delete)
                            is_deleting=is_deleting_signal
                            on_export_epub=Some(handle_export_epub.clone())
                            on_convert_to_audiobook=Some(handle_convert_to_audiobook.clone())
                            on_cancel_conversion=Some(handle_cancel_conversion.clone())
                        />
                    }.into_view()
                } else {
                    view! {}.into_view()
                }
            }}
        </div>
    }
}
