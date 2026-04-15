use sqlx::{SqlitePool, Row};
use crate::book_service::models::AppSettings;

const SETTINGS_ID: &str = "default";

pub struct SettingsRepository;

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
                auto_scroll_enabled: Some(row.get::<i64, _>("auto_scroll_enabled") != 0),
                audio_playback_speed: Some(row.get("audio_playback_speed")),
            })
        } else {
            // Return default settings if not found
            log::info!("App settings not found, returning defaults");
            Ok(AppSettings {
                theme: "system".to_string(),
                language: "en".to_string(),
                tts_language: "en".to_string(),
                tts_voice_id: "af_heart".to_string(),
                auto_scroll_enabled: Some(true),
                audio_playback_speed: Some(1.0),
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
            INSERT INTO app_settings (id, theme, language, tts_language, tts_voice_id, auto_scroll_enabled, audio_playback_speed, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                theme = excluded.theme,
                language = excluded.language,
                tts_language = excluded.tts_language,
                tts_voice_id = excluded.tts_voice_id,
                auto_scroll_enabled = excluded.auto_scroll_enabled,
                audio_playback_speed = excluded.audio_playback_speed,
                updated_at = excluded.updated_at
            "#
        )
        .bind(SETTINGS_ID)
        .bind(&model.theme)
        .bind(&model.language)
        .bind(&model.tts_language)
        .bind(&model.tts_voice_id)
        .bind(if model.auto_scroll_enabled.unwrap_or(true) { 1 } else { 0 })
        .bind(model.audio_playback_speed.unwrap_or(1.0))
        .bind(&updated_at)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save app settings: {}", e))?;
        
        Ok(())
    }
}
