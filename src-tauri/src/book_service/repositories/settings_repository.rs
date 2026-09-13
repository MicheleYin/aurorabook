use sqlx::{SqlitePool, Row};
use crate::book_service::models::AppSettings;

const SETTINGS_ID: &str = "default";

pub struct SettingsRepository;

fn optional_string(row: &sqlx::sqlite::SqliteRow, column: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(column)
        .ok()
        .flatten()
        .filter(|value| !value.is_empty())
}

fn optional_bool(row: &sqlx::sqlite::SqliteRow, column: &str, default: bool) -> Option<bool> {
    match row.try_get::<i64, _>(column) {
        Ok(value) => Some(value != 0),
        Err(_) => Some(default),
    }
}

impl SettingsRepository {
    /// Get app settings
    pub async fn get(pool: &SqlitePool) -> Result<AppSettings, String> {
        let row = sqlx::query("SELECT * FROM app_settings WHERE id = ?")
            .bind(SETTINGS_ID)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query app settings: {}", e))?;
        
        if let Some(row) = row {
            Ok(AppSettings {
                theme: row.get("theme"),
                language: row.get("language"),
                tts_language: row.get("tts_language"),
                tts_voice_id: row.get("tts_voice_id"),
                tts_synthesis_quality: row
                    .try_get::<String, _>("tts_synthesis_quality")
                    .unwrap_or_else(|_| "balanced".to_string()),
                auto_scroll_enabled: Some(row.get::<i64, _>("auto_scroll_enabled") != 0),
                audio_playback_speed: Some(row.get("audio_playback_speed")),
                last_opened_book_id: optional_string(&row, "last_opened_book_id"),
                current_tab: row
                    .try_get::<String, _>("current_tab")
                    .unwrap_or_else(|_| "library".to_string()),
                library_view_mode: row
                    .try_get::<String, _>("library_view_mode")
                    .unwrap_or_else(|_| "grid".to_string()),
                audio_player_minimized: optional_bool(&row, "audio_player_minimized", false),
                reader_header_visible: optional_bool(&row, "reader_header_visible", true),
            })
        } else {
            // Return default settings if not found
            log::info!("App settings not found, returning defaults");
            Ok(AppSettings {
                theme: "system".to_string(),
                language: "en".to_string(),
                tts_language: "en".to_string(),
                tts_voice_id: "F1".to_string(),
                tts_synthesis_quality: "balanced".to_string(),
                auto_scroll_enabled: Some(true),
                audio_playback_speed: Some(1.0),
                last_opened_book_id: None,
                current_tab: "library".to_string(),
                library_view_mode: "grid".to_string(),
                audio_player_minimized: Some(false),
                reader_header_visible: Some(true),
            })
        }
    }
    
    /// Save app settings
    pub async fn save(pool: &SqlitePool, model: &AppSettings) -> Result<(), String> {
        use std::time::{SystemTime, UNIX_EPOCH};
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string();
        
        sqlx::query(
            r#"
            INSERT INTO app_settings (
                id, theme, language, tts_language, tts_voice_id, tts_synthesis_quality,
                auto_scroll_enabled, audio_playback_speed,
                last_opened_book_id, current_tab, library_view_mode,
                audio_player_minimized, reader_header_visible, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                theme = excluded.theme,
                language = excluded.language,
                tts_language = excluded.tts_language,
                tts_voice_id = excluded.tts_voice_id,
                tts_synthesis_quality = excluded.tts_synthesis_quality,
                auto_scroll_enabled = excluded.auto_scroll_enabled,
                audio_playback_speed = excluded.audio_playback_speed,
                last_opened_book_id = excluded.last_opened_book_id,
                current_tab = excluded.current_tab,
                library_view_mode = excluded.library_view_mode,
                audio_player_minimized = excluded.audio_player_minimized,
                reader_header_visible = excluded.reader_header_visible,
                updated_at = excluded.updated_at
            "#
        )
        .bind(SETTINGS_ID)
        .bind(&model.theme)
        .bind(&model.language)
        .bind(&model.tts_language)
        .bind(&model.tts_voice_id)
        .bind(&model.tts_synthesis_quality)
        .bind(if model.auto_scroll_enabled.unwrap_or(true) { 1 } else { 0 })
        .bind(model.audio_playback_speed.unwrap_or(1.0))
        .bind(model.last_opened_book_id.as_deref())
        .bind(&model.current_tab)
        .bind(&model.library_view_mode)
        .bind(if model.audio_player_minimized.unwrap_or(false) { 1 } else { 0 })
        .bind(if model.reader_header_visible.unwrap_or(true) { 1 } else { 0 })
        .bind(&updated_at)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save app settings: {}", e))?;
        
        Ok(())
    }
}
