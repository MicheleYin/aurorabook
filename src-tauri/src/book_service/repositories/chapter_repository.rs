use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, ActiveModelTrait, Set, ConnectionTrait, QueryOrder};
use crate::book_service::entities::chapter;
use crate::book_service::models::Chapter;
use std::sync::Arc;

pub struct ChapterRepository;

impl ChapterRepository {
    /// Convert SeaORM entity to domain model
    pub fn entity_to_model(entity: chapter::Model) -> Chapter {
        Chapter {
            id: entity.id,
            title: entity.title,
            href: entity.href,
            content_html: entity.content_html,
            plain_text: entity.plain_text,
            order: entity.chapter_order as usize,
            word_count: entity.word_count.map(|v| v as usize),
            estimated_page_count: entity.estimated_page_count.map(|v| v as usize),
        }
    }
    
    /// Convert domain model to SeaORM active model
    pub fn model_to_active_model(book_id: &str, model: &Chapter) -> chapter::ActiveModel {
        chapter::ActiveModel {
            id: Set(model.id.clone()),
            book_id: Set(book_id.to_string()),
            title: Set(model.title.clone()),
            href: Set(model.href.clone()),
            content_html: Set(model.content_html.clone()),
            plain_text: Set(model.plain_text.clone()),
            chapter_order: Set(model.order as i64),
            word_count: Set(model.word_count.map(|v| v as i64)),
            estimated_page_count: Set(model.estimated_page_count.map(|v| v as i64)),
        }
    }
    
    /// Find all chapters for a book (with caching)
    pub async fn find_by_book_id(db: &DatabaseConnection, book_id: &str) -> Result<Vec<Chapter>, String> {
        // Try cache first
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            if let Some(cached_chapters) = cache.chapters_list.get(book_id).await {
                log::debug!("Cache hit for chapters list: {}", book_id);
                return Ok((*cached_chapters).clone());
            }
        }
        
        // Cache miss - query database
        let entities = chapter::Entity::find()
            .filter(chapter::Column::BookId.eq(book_id))
            .order_by_asc(chapter::Column::ChapterOrder)
            .all(db)
            .await
            .map_err(|e| format!("Failed to query chapters: {}", e))?;
        
        let chapters: Vec<Chapter> = entities.into_iter().map(Self::entity_to_model).collect();
        
        // Store in cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.chapters_list.insert(book_id.to_string(), Arc::new(chapters.clone())).await;
        }
        
        Ok(chapters)
    }
    
    /// Find chapter by book ID and href (with caching)
    pub async fn find_by_href(db: &DatabaseConnection, book_id: &str, href: &str) -> Result<Option<Chapter>, String> {
        // Try to find chapter ID from href first (we need ID for cache key)
        // For now, we'll use (book_id, href) as cache key
        let cache_key = (book_id.to_string(), href.to_string());
        
        // Try cache first
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            if let Some(cached_chapter) = cache.chapters.get(&cache_key).await {
                log::debug!("Cache hit for chapter: {} / {}", book_id, href);
                return Ok(Some((*cached_chapter).clone()));
            }
        }
        
        // Cache miss - query database
        let entity = chapter::Entity::find()
            .filter(chapter::Column::BookId.eq(book_id))
            .filter(chapter::Column::Href.eq(href))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query chapter: {}", e))?;
        
        if let Some(entity) = entity {
            let chapter = Self::entity_to_model(entity);
            
            // Store in cache
            if let Ok(cache) = crate::book_service::database::get_db_cache() {
                cache.chapters.insert(cache_key, Arc::new(chapter.clone())).await;
            }
            
            Ok(Some(chapter))
        } else {
            Ok(None)
        }
    }
    
    /// Save chapter
    pub async fn save<C: ConnectionTrait>(db: &C, book_id: &str, model: &Chapter) -> Result<(), String> {
        let active_model = Self::model_to_active_model(book_id, model);
        chapter::Entity::insert(active_model)
            .on_conflict(
                sea_orm::sea_query::OnConflict::column(chapter::Column::Id)
                    .update_columns([
                        chapter::Column::Title,
                        chapter::Column::Href,
                        chapter::Column::ContentHtml,
                        chapter::Column::PlainText,
                        chapter::Column::ChapterOrder,
                        chapter::Column::WordCount,
                        chapter::Column::EstimatedPageCount,
                    ])
                    .to_owned()
            )
            .exec(db)
            .await
            .map_err(|e| format!("Failed to save chapter: {}", e))?;
        
        // Invalidate cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.invalidate_chapter(book_id, &model.id).await;
        }
        
        Ok(())
    }
    
    /// Update chapter content
    pub async fn update_content(db: &DatabaseConnection, book_id: &str, chapter_id: &str, content_html: &str, plain_text: Option<&str>) -> Result<(), String> {
        let mut chapter: chapter::ActiveModel = chapter::Entity::find()
            .filter(chapter::Column::BookId.eq(book_id))
            .filter(chapter::Column::Id.eq(chapter_id))
            .one(db)
            .await
            .map_err(|e| format!("Failed to find chapter: {}", e))?
            .ok_or_else(|| "Chapter not found".to_string())?
            .into();
        
        chapter.content_html = Set(Some(content_html.to_string()));
        chapter.plain_text = Set(plain_text.map(|s| s.to_string()));
        
        chapter.update(db).await
            .map_err(|e| format!("Failed to update chapter content: {}", e))?;
        
        Ok(())
    }
    
    /// Delete all chapters for a book
    pub async fn delete_by_book_id<C: ConnectionTrait>(db: &C, book_id: &str) -> Result<(), String> {
        chapter::Entity::delete_many()
            .filter(chapter::Column::BookId.eq(book_id))
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete chapters: {}", e))?;
        
        // Invalidate cache
        if let Ok(cache) = crate::book_service::database::get_db_cache() {
            cache.chapters_list.invalidate(book_id).await;
        }
        
        Ok(())
    }
}

