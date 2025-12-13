use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "app_settings")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub theme: String,
    pub tts_voice_id: String,
    pub auto_scroll_enabled: i64, // SQLite uses INTEGER for boolean
    pub audio_playback_speed: f64,
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

