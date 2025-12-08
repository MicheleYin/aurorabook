use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "chapters")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub href: String,
    pub content_html: Option<String>,
    pub plain_text: Option<String>,
    pub chapter_order: i64,
    pub word_count: Option<i64>,
    pub estimated_page_count: Option<i64>,
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

