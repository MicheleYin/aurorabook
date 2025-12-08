use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, ActiveModelTrait, Set, ConnectionTrait};
use crate::book_service::entities::audio_track;
use crate::book_service::models::AudioTrack;

pub struct AudioRepository;

impl AudioRepository {
    /// Convert SeaORM entity to domain model
    pub fn entity_to_model(entity: audio_track::Model) -> AudioTrack {
        AudioTrack {
            id: entity.id,
            title: entity.title,
            href: entity.href,
            url: entity.url,
            duration: entity.duration,
        }
    }
    
    /// Convert domain model to SeaORM active model (metadata only)
    pub fn model_to_active_model(book_id: &str, model: &AudioTrack) -> audio_track::ActiveModel {
        audio_track::ActiveModel {
            id: Set(model.id.clone()),
            book_id: Set(book_id.to_string()),
            title: Set(model.title.clone()),
            href: Set(model.href.clone()),
            url: Set(model.url.clone()),
            duration: Set(model.duration),
            data: Set(None), // Data is stored separately
        }
    }
    
    /// Find all audio tracks for a book
    pub async fn find_by_book_id(db: &DatabaseConnection, book_id: &str) -> Result<Vec<AudioTrack>, String> {
        let entities = audio_track::Entity::find()
            .filter(audio_track::Column::BookId.eq(book_id))
            .all(db)
            .await
            .map_err(|e| format!("Failed to query audio tracks: {}", e))?;
        
        Ok(entities.into_iter().map(Self::entity_to_model).collect())
    }
    
    /// Save audio track metadata
    pub async fn save_metadata<C: ConnectionTrait>(db: &C, book_id: &str, model: &AudioTrack) -> Result<(), String> {
        let active_model = Self::model_to_active_model(book_id, model);
        audio_track::Entity::insert(active_model)
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(audio_track::Column::Id)
                    .update_columns([
                        audio_track::Column::Title,
                        audio_track::Column::Href,
                        audio_track::Column::Url,
                        audio_track::Column::Duration,
                    ])
                    .to_owned()
            )
            .exec(db)
            .await
            .map_err(|e| format!("Failed to save audio track: {}", e))?;
        
        Ok(())
    }
    
    /// Save audio track data
    /// If the audio track doesn't exist, creates it with minimal metadata
    pub async fn save_data(db: &DatabaseConnection, book_id: &str, href: &str, data: &[u8]) -> Result<(), String> {
        // Try to find existing track
        let existing_track = audio_track::Entity::find()
            .filter(audio_track::Column::BookId.eq(book_id))
            .filter(audio_track::Column::Href.eq(href))
            .one(db)
            .await
            .map_err(|e| format!("Failed to find audio track: {}", e))?;
        
        if let Some(existing) = existing_track {
            // Update existing track
            let mut track: audio_track::ActiveModel = existing.into();
            track.data = Set(Some(data.to_vec()));
            track.update(db).await
                .map_err(|e| format!("Failed to update audio track data: {}", e))?;
        } else {
            // Create new track with data (metadata will be minimal)
            let id = format!("{}-{}", book_id, href);
            let active_model = audio_track::ActiveModel {
                id: Set(id),
                book_id: Set(book_id.to_string()),
                title: Set(href.to_string()), // Use href as title if no metadata
                href: Set(href.to_string()),
                url: Set(None),
                duration: Set(None),
                data: Set(Some(data.to_vec())),
            };
            
            audio_track::Entity::insert(active_model)
                .exec(db)
                .await
                .map_err(|e| format!("Failed to insert audio track with data: {}", e))?;
        }
        
        Ok(())
    }
    
    /// Get audio track data
    pub async fn find_data_by_href(db: &DatabaseConnection, book_id: &str, href: &str) -> Result<Option<Vec<u8>>, String> {
        let entity = audio_track::Entity::find()
            .filter(audio_track::Column::BookId.eq(book_id))
            .filter(audio_track::Column::Href.eq(href))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query audio track: {}", e))?;
        
        Ok(entity.and_then(|e| e.data))
    }
    
    /// Delete all audio tracks for a book
    pub async fn delete_by_book_id<C: ConnectionTrait>(db: &C, book_id: &str) -> Result<(), String> {
        audio_track::Entity::delete_many()
            .filter(audio_track::Column::BookId.eq(book_id))
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete audio tracks: {}", e))?;
        
        Ok(())
    }
}

