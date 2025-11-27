use crate::book_service::models::Book;
use tauri::AppHandle;

const LIBRARY_STORE_PATH: &str = "library.store.json";
const LIBRARY_STORE_KEY: &str = "library";
const LIBRARY_STORE_VERSION: u32 = 1;

// EPUB store constants
const EPUB_STORE_PATH: &str = "epub-cache.store.json";
const EPUB_STORE_KEY_PREFIX: &str = "epub:";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct PersistedLibraryFile {
    version: u32,
    books: Vec<Book>, // Store full Book objects
}

/// Load all books from storage
pub fn load_all_books(app: &AppHandle) -> Result<Vec<Book>, String> {
    use tauri_plugin_store::StoreBuilder;
    
    let store = StoreBuilder::new(app, LIBRARY_STORE_PATH)
        .build()
        .map_err(|e| format!("Failed to create library store: {}", e))?;
    
    let library_file_value = store.get(LIBRARY_STORE_KEY);
    
    let books = if let Some(value) = library_file_value {
        match serde_json::from_value::<PersistedLibraryFile>(value) {
            Ok(file) if file.version == LIBRARY_STORE_VERSION => file.books,
            _ => Vec::new(),
        }
    } else {
        Vec::new()
    };

    Ok(books)
}

/// Save all books to storage
pub fn save_all_books(app: &AppHandle, books: &[Book]) -> Result<(), String> {
    use tauri_plugin_store::StoreBuilder;
    
    let store = StoreBuilder::new(app, LIBRARY_STORE_PATH)
        .build()
        .map_err(|e| format!("Failed to create library store: {}", e))?;
    
    let library_file = PersistedLibraryFile {
        version: LIBRARY_STORE_VERSION,
        books: books.to_vec(),
    };

    store.set(LIBRARY_STORE_KEY, serde_json::to_value(&library_file).unwrap());
    store.save();

    Ok(())
}

/// Get EPUB buffer from store
pub fn get_epub_buffer_from_store(app: &AppHandle, source_path: &str) -> Result<Option<Vec<u8>>, String> {
    use tauri_plugin_store::StoreBuilder;
    use base64::{Engine as _, engine::general_purpose};
    
    let epub_store = StoreBuilder::new(app, EPUB_STORE_PATH)
        .build()
        .map_err(|e| format!("Failed to create EPUB store: {}", e))?;
    let key = format!("{}{}", EPUB_STORE_KEY_PREFIX, source_path);
    
    let base64_value = epub_store.get(&key);
    
    if let Some(value) = base64_value {
        let base64: String = serde_json::from_value(value)
            .map_err(|e| format!("Failed to deserialize EPUB data: {}", e))?;
        let data = general_purpose::STANDARD
            .decode(&base64)
            .map_err(|e| format!("Failed to decode EPUB: {}", e))?;
        Ok(Some(data))
    } else {
        Ok(None)
    }
}

/// Save EPUB buffer to store
pub fn save_epub_buffer_to_store(app: &AppHandle, source_path: &str, epub_data: &[u8]) -> Result<(), String> {
    use tauri_plugin_store::StoreBuilder;
    use base64::{Engine as _, engine::general_purpose};
    
    let epub_store = StoreBuilder::new(app, EPUB_STORE_PATH)
        .build()
        .map_err(|e| format!("Failed to create EPUB store: {}", e))?;
    let key = format!("{}{}", EPUB_STORE_KEY_PREFIX, source_path);
    
    let base64_data = general_purpose::STANDARD.encode(epub_data);
    epub_store.set(&key, serde_json::Value::String(base64_data));
    epub_store.save();
    
    Ok(())
}

/// Delete EPUB from store
pub fn delete_epub_from_store(app: &AppHandle, source_path: &str) -> Result<(), String> {
    use tauri_plugin_store::StoreBuilder;
    
    let epub_store = StoreBuilder::new(app, EPUB_STORE_PATH)
        .build()
        .map_err(|e| format!("Failed to create EPUB store: {}", e))?;
    let key = format!("{}{}", EPUB_STORE_KEY_PREFIX, source_path);
    epub_store.delete(&key);
    epub_store.save();
    
    Ok(())
}

