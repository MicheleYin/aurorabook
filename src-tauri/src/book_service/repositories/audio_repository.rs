use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, ActiveModelTrait, Set, ConnectionTrait, QueryOrder};
use crate::book_service::entities::audio_track;
use crate::book_service::models::AudioTrack;
use std::sync::Arc;

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
            order: entity.track_order as usize,
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
            track_order: Set(model.order as i64),
            data: Set(None), // Data is stored separately
        }
    }
    
    /// Find all audio tracks for a book (ordered by track_order, with caching)
    pub async fn find_by_book_id(db: &DatabaseConnection, book_id: &str) -> Result<Vec<AudioTrack>, String> {
        // Try cache first
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            if let Some(cached_tracks) = cache.audio_tracks_list.get(book_id).await {
                log::debug!("Cache hit for audio tracks list: {}", book_id);
                return Ok((*cached_tracks).clone());
            }
        }
        
        // Cache miss - query database
        use sea_orm::QueryOrder;
        let entities = audio_track::Entity::find()
            .filter(audio_track::Column::BookId.eq(book_id))
            .order_by_asc(audio_track::Column::TrackOrder)
            .all(db)
            .await
            .map_err(|e| format!("Failed to query audio tracks: {}", e))?;
        
        let tracks: Vec<AudioTrack> = entities.into_iter().map(Self::entity_to_model).collect();
        
        // Store in cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.audio_tracks_list.insert(book_id.to_string(), Arc::new(tracks.clone())).await;
        }
        
        Ok(tracks)
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
                        audio_track::Column::TrackOrder,
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
            // Try to find the highest order to assign a new order
            let max_order = audio_track::Entity::find()
                .filter(audio_track::Column::BookId.eq(book_id))
                .order_by_desc(audio_track::Column::TrackOrder)
                .one(db)
                .await
                .map_err(|e| format!("Failed to query max order: {}", e))?
                .map(|e| e.track_order)
                .unwrap_or(-1);
            
            let id = format!("{}-{}", book_id, href);
            let active_model = audio_track::ActiveModel {
                id: Set(id),
                book_id: Set(book_id.to_string()),
                title: Set(href.to_string()), // Use href as title if no metadata
                href: Set(href.to_string()),
                url: Set(None),
                duration: Set(None),
                track_order: Set(max_order + 1), // Assign next order
                data: Set(Some(data.to_vec())),
            };
            
            audio_track::Entity::insert(active_model)
                .exec(db)
                .await
                .map_err(|e| format!("Failed to insert audio track with data: {}", e))?;
        }
        
        // Invalidate cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.invalidate_audio_data(book_id, href).await;
        }
        
        Ok(())
    }
    
    /// Get audio track data (with caching)
    pub async fn find_data_by_href(db: &DatabaseConnection, book_id: &str, href: &str) -> Result<Option<Vec<u8>>, String> {
        let cache_key = (book_id.to_string(), href.to_string());
        
        // Try cache first
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            if let Some(cached_data) = cache.audio_data.get(&cache_key).await {
                log::debug!("Cache hit for audio data: {} / {}", book_id, href);
                return Ok(Some((*cached_data).clone()));
            }
        }
        
        // Cache miss - query database
        let entity = audio_track::Entity::find()
            .filter(audio_track::Column::BookId.eq(book_id))
            .filter(audio_track::Column::Href.eq(href))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query audio track: {}", e))?;
        
        if let Some(data) = entity.and_then(|e| e.data) {
            // Store in cache
            if let Ok(cache) = crate::book_service::database::get_db_cache() {
                cache.audio_data.insert(cache_key, Arc::new(data.clone())).await;
            }
            Ok(Some(data))
        } else {
            Ok(None)
        }
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

