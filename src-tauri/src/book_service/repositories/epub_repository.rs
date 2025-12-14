use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Set, ConnectionTrait};
use crate::book_service::entities::epub_data;

pub struct EpubRepository;

impl EpubRepository {
    /// Save EPUB data by source_path
    pub async fn save<C: ConnectionTrait>(
        db: &C,
        source_path: &str,
        book_id: &str,
        data: &[u8],
    ) -> Result<(), String> {
        use std::time::{SystemTime, UNIX_EPOCH};
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string();
        
        let active_model = epub_data::ActiveModel {
            source_path: Set(source_path.to_string()),
            book_id: Set(book_id.to_string()),
            data: Set(data.to_vec()),
            updated_at: Set(updated_at),
        };
        
        epub_data::Entity::insert(active_model)
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(epub_data::Column::SourcePath)
                    .update_columns([
                        epub_data::Column::BookId,
                        epub_data::Column::Data,
                        epub_data::Column::UpdatedAt,
                    ])
                    .to_owned()
            )
            .exec(db)
            .await
            .map_err(|e| format!("Failed to save EPUB data: {}", e))?;
        
        Ok(())
    }
    
    /// Get EPUB data by source_path
    pub async fn find_by_source_path(
        db: &DatabaseConnection,
        source_path: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        let entity = epub_data::Entity::find_by_id(source_path)
            .one(db)
            .await
            .map_err(|e| format!("Failed to query EPUB data: {}", e))?;
        
        if let Some(entity) = entity {
            Ok(Some(entity.data))
        } else {
            Ok(None)
        }
    }
    
    /// Get EPUB data by book_id
    pub async fn find_by_book_id(
        db: &DatabaseConnection,
        book_id: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        let entity = epub_data::Entity::find()
            .filter(epub_data::Column::BookId.eq(book_id))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query EPUB data: {}", e))?;
        
        if let Some(entity) = entity {
            Ok(Some(entity.data))
        } else {
            Ok(None)
        }
    }
    
    /// Delete EPUB data by source_path
    pub async fn delete_by_source_path<C: ConnectionTrait>(
        db: &C,
        source_path: &str,
    ) -> Result<(), String> {
        epub_data::Entity::delete_by_id(source_path)
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete EPUB data: {}", e))?;
        
        Ok(())
    }
    
    /// Delete EPUB data by book_id
    pub async fn delete_by_book_id<C: ConnectionTrait>(
        db: &C,
        book_id: &str,
    ) -> Result<(), String> {
        epub_data::Entity::delete_many()
            .filter(epub_data::Column::BookId.eq(book_id))
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete EPUB data: {}", e))?;
        
        Ok(())
    }
}

