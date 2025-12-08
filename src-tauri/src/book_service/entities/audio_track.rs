use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "audio_tracks")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub href: String,
    pub url: Option<String>,
    pub duration: Option<f64>,
    pub track_order: i64,
    // Vec<u8> is automatically mapped to BLOB in SQLite
    pub data: Option<Vec<u8>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::book::Entity",
        from = "Column::BookId",
        to = "super::book::Column::Id"
    )]
    Book,
}

impl Related<super::book::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Book.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

