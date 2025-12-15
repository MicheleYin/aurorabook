use leptos::*;
use crate::types::reader::ReaderPreferences;
use crate::services::book_service::invoke_tauri_command;
use wasm_bindgen::prelude::*;
use serde_wasm_bindgen;
use leptos::spawn_local;

fn default_reader_preferences() -> ReaderPreferences {
    ReaderPreferences {
        theme: crate::types::reader::ReaderTheme::System,
        font_family: crate::types::reader::ReaderFont::Merriweather,
        content_padding: crate::types::reader::ReaderContentPadding::Comfortable,
        font_size: crate::types::reader::ReaderFontSize::Medium,
    }
}

pub fn use_persistent_reader_preferences() -> (
    ReadSignal<ReaderPreferences>,
    Callback<ReaderPreferences>,
    Callback<ReaderPreferences>,
    ReadSignal<bool>,
) {
    let (preferences, set_preferences) = create_signal(default_reader_preferences());
    let (is_hydrated, set_is_hydrated) = create_signal(false);
    
    // Load preferences from backend on mount
    spawn_local({
        let set_prefs = set_preferences.clone();
        let set_hydrated = set_is_hydrated.clone();
        async move {
            let args = serde_wasm_bindgen::to_value(&serde_json::json!({}))
                .unwrap_or_else(|_| JsValue::NULL);
            match invoke_tauri_command::<ReaderPreferences>("get_reader_preferences", args).await {
                Ok(loaded_prefs) => {
                    set_prefs.set(loaded_prefs);
                    set_hydrated.set(true);
                }
                Err(e) => {
                    web_sys::console::warn_1(&format!("Failed to load reader preferences: {}", e).into());
                    set_hydrated.set(true);
                }
            }
        }
    });
    
    let set_preferences_direct = Callback::new({
        let set_prefs = set_preferences.clone();
        move |new_prefs: ReaderPreferences| {
            set_prefs.set(new_prefs.clone());
            // Persist to backend asynchronously
            let prefs_for_async = new_prefs;
            spawn_local(async move {
                let args = serde_wasm_bindgen::to_value(&serde_json::json!({
                    "preferences": prefs_for_async
                })).unwrap_or_else(|_| JsValue::NULL);
                if let Err(e) = invoke_tauri_command::<()>("update_reader_preferences", args).await {
                    web_sys::console::warn_1(&format!("Failed to persist reader preferences: {}", e).into());
                }
            });
        }
    });
    
    let update_preferences = Callback::new({
        move |update: ReaderPreferences| {
            set_preferences_direct.call(update);
        }
    });
    
    (preferences, set_preferences_direct, update_preferences, is_hydrated)
}
