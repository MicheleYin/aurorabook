use sqlx::{Row, SqlitePool};

use crate::book_service::models::KeyboardShortcutBinding;

pub struct KeyboardShortcutsRepository;

fn now_secs() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string()
}

impl KeyboardShortcutsRepository {
    /// List all custom (non-default) shortcut bindings.
    pub async fn list(pool: &SqlitePool) -> Result<Vec<KeyboardShortcutBinding>, String> {
        let rows = sqlx::query(
            "SELECT action_id, keys_json, match_json FROM keyboard_shortcuts ORDER BY action_id",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to query keyboard shortcuts: {}", e))?;

        let mut bindings = Vec::with_capacity(rows.len());
        for row in rows {
            let action_id: String = row.get("action_id");
            let keys_json: String = row.get("keys_json");
            let match_json: String = row.get("match_json");

            let keys: Vec<String> = serde_json::from_str(&keys_json).map_err(|e| {
                format!("Invalid keys_json for shortcut {}: {}", action_id, e)
            })?;
            let match_chords: serde_json::Value =
                serde_json::from_str(&match_json).map_err(|e| {
                    format!("Invalid match_json for shortcut {}: {}", action_id, e)
                })?;

            bindings.push(KeyboardShortcutBinding {
                action_id,
                keys,
                match_chords,
            });
        }
        Ok(bindings)
    }

    /// Upsert one custom binding.
    pub async fn upsert(
        pool: &SqlitePool,
        binding: &KeyboardShortcutBinding,
    ) -> Result<(), String> {
        if binding.action_id.trim().is_empty() {
            return Err("action_id is required".to_string());
        }
        if !binding.match_chords.is_array() {
            return Err("match must be a JSON array".to_string());
        }

        let keys_json = serde_json::to_string(&binding.keys)
            .map_err(|e| format!("Failed to serialize keys: {}", e))?;
        let match_json = serde_json::to_string(&binding.match_chords)
            .map_err(|e| format!("Failed to serialize match: {}", e))?;
        let updated_at = now_secs();

        sqlx::query(
            r#"
            INSERT INTO keyboard_shortcuts (action_id, keys_json, match_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(action_id) DO UPDATE SET
                keys_json = excluded.keys_json,
                match_json = excluded.match_json,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&binding.action_id)
        .bind(&keys_json)
        .bind(&match_json)
        .bind(&updated_at)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save keyboard shortcut: {}", e))?;

        Ok(())
    }

    /// Remove one custom binding (restore that action to defaults).
    pub async fn delete(pool: &SqlitePool, action_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM keyboard_shortcuts WHERE action_id = ?")
            .bind(action_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to reset keyboard shortcut: {}", e))?;
        Ok(())
    }

    /// Remove all custom bindings (restore every action to defaults).
    pub async fn delete_all(pool: &SqlitePool) -> Result<(), String> {
        sqlx::query("DELETE FROM keyboard_shortcuts")
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to reset keyboard shortcuts: {}", e))?;
        Ok(())
    }
}
