use serde_json::Value;
use sqlx::{Row, SqlitePool};

use crate::book_service::models::AppLogEntry;

/// Retain log rows for this long (matches product requirement).
pub const APP_LOG_RETENTION: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// Soft cap so the table cannot grow without bound if cleanup is delayed.
const MAX_ROWS: i64 = 5_000;

pub struct AppLogsRepository;

impl AppLogsRepository {
    pub async fn append(pool: &SqlitePool, entry: &AppLogEntry) -> Result<(), String> {
        let created_at_ms = now_ms();
        let data_json = match &entry.data {
            Some(value) => Some(
                serde_json::to_string(value)
                    .map_err(|e| format!("Failed to serialize log data: {e}"))?,
            ),
            None => None,
        };

        sqlx::query(
            r#"
            INSERT INTO app_logs (timestamp, created_at_ms, level, source, message, data)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&entry.timestamp)
        .bind(created_at_ms)
        .bind(&entry.level)
        .bind(&entry.source)
        .bind(&entry.message)
        .bind(data_json)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to append app log: {e}"))?;

        Ok(())
    }

    pub async fn list(pool: &SqlitePool) -> Result<Vec<AppLogEntry>, String> {
        let rows = sqlx::query(
            r#"
            SELECT timestamp, level, source, message, data
            FROM app_logs
            ORDER BY created_at_ms ASC, id ASC
            LIMIT ?
            "#,
        )
        .bind(MAX_ROWS)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list app logs: {e}"))?;

        let mut logs = Vec::with_capacity(rows.len());
        for row in rows {
            let data_raw: Option<String> = row.try_get("data").ok().flatten();
            let data = data_raw.and_then(|s| serde_json::from_str::<Value>(&s).ok());
            logs.push(AppLogEntry {
                timestamp: row.get("timestamp"),
                level: row.get("level"),
                source: row.get("source"),
                message: row.get("message"),
                data,
            });
        }
        Ok(logs)
    }

    pub async fn clear(pool: &SqlitePool) -> Result<(), String> {
        sqlx::query("DELETE FROM app_logs")
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to clear app logs: {e}"))?;
        Ok(())
    }

    /// Delete rows older than 24 hours (and trim if over the soft cap).
    pub async fn cleanup(pool: &SqlitePool) -> Result<u64, String> {
        let cutoff_ms = now_ms().saturating_sub(APP_LOG_RETENTION.as_millis() as i64);
        let aged = sqlx::query("DELETE FROM app_logs WHERE created_at_ms < ?")
            .bind(cutoff_ms)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to cleanup old app logs: {e}"))?
            .rows_affected();

        // Keep only the newest MAX_ROWS if anything remains oversized.
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM app_logs")
            .fetch_one(pool)
            .await
            .map_err(|e| format!("Failed to count app logs: {e}"))?;
        let mut trimmed = 0u64;
        if count > MAX_ROWS {
            let to_delete = count - MAX_ROWS;
            trimmed = sqlx::query(
                r#"
                DELETE FROM app_logs
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id FROM app_logs
                        ORDER BY created_at_ms ASC, id ASC
                        LIMIT ?
                    )
                )
                "#,
            )
            .bind(to_delete)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to trim app logs: {e}"))?
            .rows_affected();
        }

        Ok(aged + trimmed)
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
