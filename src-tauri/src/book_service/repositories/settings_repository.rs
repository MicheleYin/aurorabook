use sea_orm::{DatabaseConnection, EntityTrait, Set};
use crate::book_service::entities::app_settings;
use crate::book_service::models::AppSettings;
use std::sync::Arc;

const SETTINGS_ID: &str = "default";

pub struct SettingsRepository;

impl SettingsRepository {
    /// Convert SeaORM entity to domain model
    pub fn entity_to_model(entity: app_settings::Model) -> AppSettings {
        AppSettings {
            theme: entity.theme,
            tts_voice_id: entity.tts_voice_id,
            auto_scroll_enabled: Some(entity.auto_scroll_enabled != 0),
            audio_playback_speed: Some(entity.audio_playback_speed),
        }
    }
    
    /// Convert domain model to SeaORM active model
    pub fn model_to_active_model(model: &AppSettings) -> app_settings::ActiveModel {
        use std::time::{SystemTime, UNIX_EPOCH};
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string();
        
        app_settings::ActiveModel {
            id: Set(SETTINGS_ID.to_string()),
            theme: Set(model.theme.clone()),
            tts_voice_id: Set(model.tts_voice_id.clone()),
            auto_scroll_enabled: Set(if model.auto_scroll_enabled.unwrap_or(true) { 1 } else { 0 }),
            audio_playback_speed: Set(model.audio_playback_speed.unwrap_or(1.0)),
            updated_at: Set(updated_at),
        }
    }
    
    /// Get app settings (with caching)
    pub async fn get(db: &DatabaseConnection) -> Result<AppSettings, String> {
        // Try cache first
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            if let Some(cached_settings) = cache.app_settings.get(SETTINGS_ID).await {
                log::debug!("Cache hit for app settings");
                return Ok((*cached_settings).clone());
            }
        }
        
        // Cache miss - query database
        let entity = app_settings::Entity::find_by_id(SETTINGS_ID)
            .one(db)
            .await
            .map_err(|e| format!("Failed to query app settings: {}", e))?;
        
        let settings = if let Some(entity) = entity {
            Self::entity_to_model(entity)
        } else {
            // Return default settings if not found
            log::info!("App settings not found, returning defaults");
            AppSettings {
                theme: "system".to_string(),
                tts_voice_id: "af_heart".to_string(), // Default from constants
                auto_scroll_enabled: Some(true),
                audio_playback_speed: Some(1.0),
            }
        };
        
        // Store in cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.app_settings.insert(SETTINGS_ID.to_string(), Arc::new(settings.clone())).await;
        }
        
        Ok(settings)
    }
    
    /// Save app settings
    pub async fn save(db: &DatabaseConnection, model: &AppSettings) -> Result<(), String> {
        let active_model = Self::model_to_active_model(model);
        
        // Use upsert (insert or update)
        app_settings::Entity::insert(active_model.clone())
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(app_settings::Column::Id)
                    .update_columns([
                        app_settings::Column::Theme,
                        app_settings::Column::TtsVoiceId,
                        app_settings::Column::AutoScrollEnabled,
                        app_settings::Column::AudioPlaybackSpeed,
                        app_settings::Column::UpdatedAt,
                    ])
                    .to_owned()
            )
            .exec(db)
            .await
            .map_err(|e| format!("Failed to save app settings: {}", e))?;
        
        // Update cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.app_settings.insert(SETTINGS_ID.to_string(), Arc::new(model.clone())).await;
        }
        
        Ok(())
    }
}

