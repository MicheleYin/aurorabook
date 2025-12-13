use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "reader_preferences")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub theme: String,
    pub font_family: String,
    pub content_padding: String,
    pub font_size: String,
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

