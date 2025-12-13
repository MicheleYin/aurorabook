use sea_orm::{DatabaseConnection, EntityTrait, Set};
use crate::book_service::entities::reader_preferences;
use crate::book_service::models::ReaderPreferences;
use std::sync::Arc;

const PREFERENCES_ID: &str = "default";

pub struct ReaderPreferencesRepository;

impl ReaderPreferencesRepository {
    /// Convert SeaORM entity to domain model
    pub fn entity_to_model(entity: reader_preferences::Model) -> ReaderPreferences {
        ReaderPreferences {
            theme: entity.theme,
            font_family: entity.font_family,
            content_padding: entity.content_padding,
            font_size: entity.font_size,
        }
    }
    
    /// Convert domain model to SeaORM active model
    pub fn model_to_active_model(model: &ReaderPreferences) -> reader_preferences::ActiveModel {
        use std::time::{SystemTime, UNIX_EPOCH};
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string();
        
        reader_preferences::ActiveModel {
            id: Set(PREFERENCES_ID.to_string()),
            theme: Set(model.theme.clone()),
            font_family: Set(model.font_family.clone()),
            content_padding: Set(model.content_padding.clone()),
            font_size: Set(model.font_size.clone()),
            updated_at: Set(updated_at),
        }
    }
    
    /// Get reader preferences (with caching)
    pub async fn get(db: &DatabaseConnection) -> Result<ReaderPreferences, String> {
        // Try cache first
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            if let Some(cached_prefs) = cache.reader_preferences.get(PREFERENCES_ID).await {
                log::debug!("Cache hit for reader preferences");
                return Ok((*cached_prefs).clone());
            }
        }
        
        // Cache miss - query database
        let entity = reader_preferences::Entity::find_by_id(PREFERENCES_ID)
            .one(db)
            .await
            .map_err(|e| format!("Failed to query reader preferences: {}", e))?;
        
        let preferences = if let Some(entity) = entity {
            Self::entity_to_model(entity)
        } else {
            // Return default preferences if not found
            log::info!("Reader preferences not found, returning defaults");
            ReaderPreferences {
                theme: "system".to_string(),
                font_family: "merriweather".to_string(),
                content_padding: "comfortable".to_string(),
                font_size: "medium".to_string(),
            }
        };
        
        // Store in cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.reader_preferences.insert(PREFERENCES_ID.to_string(), Arc::new(preferences.clone())).await;
        }
        
        Ok(preferences)
    }
    
    /// Save reader preferences
    pub async fn save(db: &DatabaseConnection, model: &ReaderPreferences) -> Result<(), String> {
        let active_model = Self::model_to_active_model(model);
        
        // Use upsert (insert or update)
        reader_preferences::Entity::insert(active_model.clone())
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(reader_preferences::Column::Id)
                    .update_columns([
                        reader_preferences::Column::Theme,
                        reader_preferences::Column::FontFamily,
                        reader_preferences::Column::ContentPadding,
                        reader_preferences::Column::FontSize,
                        reader_preferences::Column::UpdatedAt,
                    ])
                    .to_owned()
            )
            .exec(db)
            .await
            .map_err(|e| format!("Failed to save reader preferences: {}", e))?;
        
        // Update cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.reader_preferences.insert(PREFERENCES_ID.to_string(), Arc::new(model.clone())).await;
        }
        
        Ok(())
    }
}

