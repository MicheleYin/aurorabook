use crate::types::settings::AppSettings;
use crate::constants::default_kokoro_voice_id;
use crate::services::book_service::invoke_tauri_command;
use wasm_bindgen::{JsValue, prelude::*};

/// Default settings
pub fn default_settings() -> AppSettings {
    AppSettings {
        theme: crate::types::settings::UITheme::System,
        tts_voice_id: default_kokoro_voice_id(),
        auto_scroll_enabled: Some(true),
        audio_playback_speed: Some(1.0),
    }
}

/// Load app settings from backend
pub async fn get_app_settings() -> Result<AppSettings, String> {
    let args: JsValue = serde_wasm_bindgen::to_value(&serde_json::json!({}))
        .map_err(|e| format!("Serialization failed: {}", e))?;
    
    let result = invoke_tauri_command::<serde_json::Value>("get_app_settings", args).await?;
    
    // Convert JSON to AppSettings, merging with defaults
    let loaded: AppSettings = serde_json::from_value(result)
        .map_err(|e| format!("Failed to deserialize settings: {}", e))?;
    
    // Merge with defaults to ensure all fields are present
    let mut settings = default_settings();
    settings.theme = loaded.theme;
    settings.tts_voice_id = loaded.tts_voice_id;
    settings.auto_scroll_enabled = loaded.auto_scroll_enabled.or(settings.auto_scroll_enabled);
    settings.audio_playback_speed = loaded.audio_playback_speed.or(settings.audio_playback_speed);
    
    Ok(settings)
}

/// Update app settings in backend
pub async fn update_app_settings(settings: &AppSettings) -> Result<AppSettings, String> {
    let settings_json = serde_json::to_value(settings)
        .map_err(|e| format!("Serialization failed: {}", e))?;
    
    let args: JsValue = serde_wasm_bindgen::to_value(&serde_json::json!({
        "settings": settings_json
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    let result = invoke_tauri_command::<serde_json::Value>("update_app_settings", args).await?;
    
    serde_json::from_value(result)
        .map_err(|e| format!("Failed to deserialize settings: {}", e))
}
