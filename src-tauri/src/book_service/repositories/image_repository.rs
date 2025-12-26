use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Set, ConnectionTrait};
use crate::book_service::entities::image;
use sha2::{Sha256, Digest};

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
        
        // Image is saved via write queue in hybrid store
        
        Ok(())
    }
    
    /// Get image (with hybrid store)
    pub async fn find_by_href(db: &DatabaseConnection, book_id: &str, href: &str) -> Result<Option<(String, Vec<u8>)>, String> {
        // Try hybrid store first
        if let Ok(store) = crate::book_service::database::get_hybrid_store() {
            if let Some(image) = store.get_image(book_id, href) {
                log::debug!("Hybrid store hit for image: {} / {}", book_id, href);
                return Ok(Some(image));
            }
        }
        
        // Store miss - query database
        let entity = image::Entity::find()
            .filter(image::Column::BookId.eq(book_id))
            .filter(image::Column::Href.eq(href))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query image: {}", e))?;
        
        if let Some(entity) = entity {
            // Clone data for return value
            let result = (entity.mime_type.clone(), entity.data.clone());
            
            // Load into hybrid store (uses cloned data)
            if let Ok(store) = crate::book_service::database::get_hybrid_store() {
                store.load_image(book_id.to_string(), href.to_string(), result.0.clone(), result.1.clone()).await;
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

