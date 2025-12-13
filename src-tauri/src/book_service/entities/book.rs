use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "books")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub title: String,
    pub author: String,
    #[sea_orm(unique)]
    pub source_path: String,
    pub cover_url: Option<String>,
    pub publisher: Option<String>,
    pub published_year: Option<String>,
    pub subjects: Option<String>, // JSON array
    pub file_size_bytes: Option<i64>,
    pub progress_current_chapter_id: Option<String>,
    pub progress_current_chapter_href: Option<String>,
    pub progress_current_chapter_index: Option<i64>,
    pub progress_current_chapter_element_id: Option<String>,
    pub progress_current_chapter_element_index: Option<i64>,
    pub progress_current_chapter_scroll_top: Option<f64>,
    pub progress_current_chapter_scroll_height: Option<f64>,
    pub progress_current_chapter_client_height: Option<f64>,
    pub progress_chapter_progress_percent: Option<f64>,
    pub progress_book_progress_percent: Option<f64>,
    pub progress_updated_at: Option<String>,
    pub audio_state_current_track_id: Option<String>,
    pub audio_state_current_track_href: Option<String>,
    pub audio_state_current_track_index: Option<i64>,
    pub audio_state_current_time_seconds: Option<f64>,
    pub audio_state_updated_at: Option<String>,
    pub audio_sync_map: Option<String>, // JSON
    pub page_count: Option<i64>,
    pub conversion_status: String,
    pub completed_chapters: Option<String>, // JSON array
    pub voice_id: Option<String>,
    pub total_words: Option<i64>,
    pub words_processed: Option<i64>,
    pub last_opened_time: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::chapter::Entity")]
    Chapters,
    #[sea_orm(has_many = "super::image::Entity")]
    Images,
    #[sea_orm(has_many = "super::audio_track::Entity")]
    AudioTracks,
}

impl Related<super::chapter::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Chapters.def()
    }
}

impl Related<super::image::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Images.def()
    }
}

impl Related<super::audio_track::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AudioTracks.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

