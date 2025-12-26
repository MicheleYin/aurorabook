use sqlx::{SqlitePool, Row};
use crate::book_service::models::ReaderPreferences;

const PREFERENCES_ID: &str = "default";

pub struct ReaderPreferencesRepository;

impl ReaderPreferencesRepository {
    /// Get reader preferences
    pub async fn get(pool: &SqlitePool) -> Result<ReaderPreferences, String> {
        let row = sqlx::query("SELECT * FROM reader_preferences WHERE id = ?")
            .bind(PREFERENCES_ID)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to query reader preferences: {}", e))?;
        
        if let Some(row) = row {
            Ok(ReaderPreferences {
                theme: row.get("theme"),
                font_family: row.get("font_family"),
                content_padding: row.get("content_padding"),
                font_size: row.get("font_size"),
            })
        } else {
            // Return default preferences if not found
            log::info!("Reader preferences not found, returning defaults");
            Ok(ReaderPreferences {
                theme: "system".to_string(),
                font_family: "merriweather".to_string(),
                content_padding: "comfortable".to_string(),
                font_size: "medium".to_string(),
            })
        }
    }
    
    /// Save reader preferences
    pub async fn save(pool: &SqlitePool, model: &ReaderPreferences) -> Result<(), String> {
        use std::time::{SystemTime, UNIX_EPOCH};
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string();
        
        sqlx::query(
            r#"
            INSERT INTO reader_preferences (id, theme, font_family, content_padding, font_size, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                theme = excluded.theme,
                font_family = excluded.font_family,
                content_padding = excluded.content_padding,
                font_size = excluded.font_size,
                updated_at = excluded.updated_at
            "#
        )
        .bind(PREFERENCES_ID)
        .bind(&model.theme)
        .bind(&model.font_family)
        .bind(&model.content_padding)
        .bind(&model.font_size)
        .bind(&updated_at)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save reader preferences: {}", e))?;
        
        Ok(())
    }
}
