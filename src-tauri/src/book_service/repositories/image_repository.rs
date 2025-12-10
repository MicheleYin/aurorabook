use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Set, ConnectionTrait};
use crate::book_service::entities::image;
use sha2::{Sha256, Digest};
use std::sync::Arc;

pub struct ImageRepository;

impl ImageRepository {
    /// Generate image ID from book_id and href
    fn generate_id(book_id: &str, href: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(book_id.as_bytes());
        hasher.update(href.as_bytes());
        format!("{:x}", hasher.finalize())
    }
    
    /// Save image
    pub async fn save<C: ConnectionTrait>(db: &C, book_id: &str, href: &str, mime_type: &str, data: &[u8]) -> Result<(), String> {
        let id = Self::generate_id(book_id, href);
        let active_model = image::ActiveModel {
            id: Set(id),
            book_id: Set(book_id.to_string()),
            href: Set(href.to_string()),
            mime_type: Set(mime_type.to_string()),
            data: Set(data.to_vec()),
        };
        
        image::Entity::insert(active_model)
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(image::Column::Id)
                    .update_columns([
                        image::Column::MimeType,
                        image::Column::Data,
                    ])
                    .to_owned()
            )
            .exec(db)
            .await
            .map_err(|e| format!("Failed to save image: {}", e))?;
        
        // Invalidate cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.invalidate_image(book_id, href).await;
        }
        
        Ok(())
    }
    
    /// Get image (with caching)
    pub async fn find_by_href(db: &DatabaseConnection, book_id: &str, href: &str) -> Result<Option<(String, Vec<u8>)>, String> {
        let cache_key = (book_id.to_string(), href.to_string());
        
        // Try cache first
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            if let Some(cached_image) = cache.images.get(&cache_key).await {
                log::debug!("Cache hit for image: {} / {}", book_id, href);
                return Ok(Some((*cached_image).clone()));
            }
        }
        
        // Cache miss - query database
        let entity = image::Entity::find()
            .filter(image::Column::BookId.eq(book_id))
            .filter(image::Column::Href.eq(href))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query image: {}", e))?;
        
        if let Some(entity) = entity {
            let result = (entity.mime_type, entity.data);
            
            // Store in cache
            if let Ok(cache) = crate::book_service::database::get_db_cache() {
                cache.images.insert(cache_key, Arc::new(result.clone())).await;
            }
            
            Ok(Some(result))
        } else {
            Ok(None)
        }
    }
    
    /// Delete all images for a book
    pub async fn delete_by_book_id<C: ConnectionTrait>(db: &C, book_id: &str) -> Result<(), String> {
        image::Entity::delete_many()
            .filter(image::Column::BookId.eq(book_id))
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete images: {}", e))?;
        
        Ok(())
    }
}

