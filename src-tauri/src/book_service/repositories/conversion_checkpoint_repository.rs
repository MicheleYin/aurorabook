use sqlx::{SqlitePool, Row};
use kokoros::tts::koko::WordAlignment;
use serde_json;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct ConversionCheckpoint {
    pub book_id: String,
    pub chapter_index: usize,
    pub chapter_id: Option<String>,
    pub chapter_href: Option<String>,
    pub sentences_processed: usize,
    pub total_sentences: usize,
    pub audio_duration_seconds: f64,
    pub checkpoint_timestamp: String,
}

#[derive(Clone, Debug)]
pub struct LiveSentenceAudio {
    pub book_id: String,
    pub chapter_index: usize,
    pub sentence_index: usize,
    pub audio_file_path: String,
    pub duration_seconds: f64,
    pub sentence_text: String,
    pub word_alignments: Vec<WordAlignment>,
    pub created_at: String,
}

pub struct ConversionCheckpointRepository;

impl ConversionCheckpointRepository {
    fn now_unix_millis_string() -> String {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis().to_string())
            .unwrap_or_else(|_| "0".to_string())
    }

    /// Get the base checkpoint storage directory for a book
    /// Audio files are stored on filesystem to avoid SQLite BLOB performance issues
    /// Uses app data directory instead of cache to persist across sessions
    pub fn get_checkpoint_dir(base_dir: &std::path::Path, book_id: &str) -> PathBuf {
        base_dir.join("checkpoints").join(book_id)
    }

    /// Get the audio file path for a sentence checkpoint
    pub fn get_audio_file_path(base_dir: &std::path::Path, book_id: &str, chapter_index: usize, sentence_index: usize) -> PathBuf {
        let checkpoint_dir = Self::get_checkpoint_dir(base_dir, book_id);
        checkpoint_dir.join(format!("ch{}_sent{}.mp3", chapter_index, sentence_index))
    }

    /// Ensure checkpoint directory exists
    pub fn ensure_checkpoint_dir(base_dir: &std::path::Path, book_id: &str) -> Result<(), String> {
        let checkpoint_dir = Self::get_checkpoint_dir(base_dir, book_id);
        std::fs::create_dir_all(&checkpoint_dir)
            .map_err(|e| format!("Failed to create checkpoint directory: {}", e))?;
        Ok(())
    }

    /// Save or update a conversion checkpoint
    pub async fn save_checkpoint(
        pool: &SqlitePool,
        book_id: &str,
        chapter_index: usize,
        chapter_id: Option<String>,
        chapter_href: Option<String>,
        sentences_processed: usize,
        total_sentences: usize,
        audio_duration_seconds: f64,
    ) -> Result<(), String> {
        let checkpoint_timestamp = Self::now_unix_millis_string();

        sqlx::query(
            r#"
            INSERT INTO live_conversion_checkpoint
            (book_id, chapter_index, chapter_id, chapter_href, sentences_processed, 
             total_sentences, audio_duration_seconds, checkpoint_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(book_id, chapter_index) DO UPDATE SET
                sentences_processed = excluded.sentences_processed,
                audio_duration_seconds = excluded.audio_duration_seconds,
                checkpoint_timestamp = excluded.checkpoint_timestamp
            "#,
        )
        .bind(book_id)
        .bind(chapter_index as i64)
        .bind(chapter_id)
        .bind(chapter_href)
        .bind(sentences_processed as i64)
        .bind(total_sentences as i64)
        .bind(audio_duration_seconds)
        .bind(checkpoint_timestamp)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save conversion checkpoint: {}", e))?;

        Ok(())
    }

    /// Load a conversion checkpoint for a chapter
    pub async fn load_checkpoint(
        pool: &SqlitePool,
        book_id: &str,
        chapter_index: usize,
    ) -> Result<Option<ConversionCheckpoint>, String> {
        let row = sqlx::query(
            r#"
            SELECT book_id, chapter_index, chapter_id, chapter_href, sentences_processed,
                   total_sentences, audio_duration_seconds, checkpoint_timestamp
            FROM live_conversion_checkpoint
            WHERE book_id = ? AND chapter_index = ?
            "#,
        )
        .bind(book_id)
        .bind(chapter_index as i64)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to load conversion checkpoint: {}", e))?;

        Ok(row.map(|r| ConversionCheckpoint {
            book_id: r.get("book_id"),
            chapter_index: r.get::<i64, _>("chapter_index") as usize,
            chapter_id: r.get("chapter_id"),
            chapter_href: r.get("chapter_href"),
            sentences_processed: r.get::<i64, _>("sentences_processed") as usize,
            total_sentences: r.get::<i64, _>("total_sentences") as usize,
            audio_duration_seconds: r.get("audio_duration_seconds"),
            checkpoint_timestamp: r.get("checkpoint_timestamp"),
        }))
    }

    /// Delete a conversion checkpoint (after conversion completes or is abandoned)
    pub async fn delete_checkpoint(
        pool: &SqlitePool,
        book_id: &str,
        chapter_index: usize,
    ) -> Result<(), String> {
        sqlx::query(
            r#"
            DELETE FROM live_conversion_checkpoint
            WHERE book_id = ? AND chapter_index = ?
            "#,
        )
        .bind(book_id)
        .bind(chapter_index as i64)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to delete conversion checkpoint: {}", e))?;

        Ok(())
    }

    /// Delete all checkpoints for a book (on conversion completion)
    pub async fn delete_all_checkpoints(
        pool: &SqlitePool,
        book_id: &str,
    ) -> Result<(), String> {
        sqlx::query("DELETE FROM live_conversion_checkpoint WHERE book_id = ?")
            .bind(book_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to delete all checkpoints: {}", e))?;

        Ok(())
    }

    /// Save a sentence with alignments during live conversion
    /// Audio file should already be saved to disk; this stores the metadata
    pub async fn save_sentence_alignment(
        pool: &SqlitePool,
        book_id: &str,
        chapter_index: usize,
        sentence_index: usize,
        audio_file_path: &str,
        duration_seconds: f64,
        sentence_text: &str,
        word_alignments: &[WordAlignment],
    ) -> Result<(), String> {
        let alignments_json = serde_json::to_string(word_alignments)
            .map_err(|e| format!("Failed to serialize word alignments: {}", e))?;
        let created_at = Self::now_unix_millis_string();

        sqlx::query(
            r#"
            INSERT INTO live_sentence_alignment
            (book_id, chapter_index, sentence_index, audio_file_path, duration_seconds,
             sentence_text, word_alignments, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(book_id, chapter_index, sentence_index) DO UPDATE SET
                audio_file_path = excluded.audio_file_path,
                duration_seconds = excluded.duration_seconds,
                word_alignments = excluded.word_alignments,
                created_at = excluded.created_at
            "#,
        )
        .bind(book_id)
        .bind(chapter_index as i64)
        .bind(sentence_index as i64)
        .bind(audio_file_path)
        .bind(duration_seconds)
        .bind(sentence_text)
        .bind(alignments_json)
        .bind(created_at)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save sentence alignment: {}", e))?;

        Ok(())
    }

    /// Load all saved sentences for a chapter (for resuming conversion)
    pub async fn load_chapter_sentences(
        pool: &SqlitePool,
        book_id: &str,
        chapter_index: usize,
    ) -> Result<Vec<LiveSentenceAudio>, String> {
        let rows = sqlx::query(
            r#"
            SELECT book_id, chapter_index, sentence_index, audio_file_path, duration_seconds,
                   sentence_text, word_alignments, created_at
            FROM live_sentence_alignment
            WHERE book_id = ? AND chapter_index = ?
            ORDER BY sentence_index
            "#,
        )
        .bind(book_id)
        .bind(chapter_index as i64)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to load chapter sentences: {}", e))?;

        let mut sentences = Vec::new();
        for row in rows {
            let alignments_json: String = row.get("word_alignments");
            let word_alignments: Vec<WordAlignment> = serde_json::from_str(&alignments_json)
                .map_err(|e| format!("Failed to deserialize word alignments: {}", e))?;

            sentences.push(LiveSentenceAudio {
                book_id: row.get("book_id"),
                chapter_index: row.get::<i64, _>("chapter_index") as usize,
                sentence_index: row.get::<i64, _>("sentence_index") as usize,
                audio_file_path: row.get("audio_file_path"),
                duration_seconds: row.get("duration_seconds"),
                sentence_text: row.get("sentence_text"),
                word_alignments,
                created_at: row.get("created_at"),
            });
        }

        Ok(sentences)
    }

    /// Load a single sentence alignment (for playback resumption)
    pub async fn load_sentence_alignment(
        pool: &SqlitePool,
        book_id: &str,
        chapter_index: usize,
        sentence_index: usize,
    ) -> Result<Option<LiveSentenceAudio>, String> {
        let row = sqlx::query(
            r#"
            SELECT book_id, chapter_index, sentence_index, audio_file_path, duration_seconds,
                   sentence_text, word_alignments, created_at
            FROM live_sentence_alignment
            WHERE book_id = ? AND chapter_index = ? AND sentence_index = ?
            "#,
        )
        .bind(book_id)
        .bind(chapter_index as i64)
        .bind(sentence_index as i64)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to load sentence alignment: {}", e))?;

        if let Some(row) = row {
            let alignments_json: String = row.get("word_alignments");
            let word_alignments: Vec<WordAlignment> = serde_json::from_str(&alignments_json)
                .map_err(|e| format!("Failed to deserialize word alignments: {}", e))?;

            Ok(Some(LiveSentenceAudio {
                book_id: row.get("book_id"),
                chapter_index: row.get::<i64, _>("chapter_index") as usize,
                sentence_index: row.get::<i64, _>("sentence_index") as usize,
                audio_file_path: row.get("audio_file_path"),
                duration_seconds: row.get("duration_seconds"),
                sentence_text: row.get("sentence_text"),
                word_alignments,
                created_at: row.get("created_at"),
            }))
        } else {
            Ok(None)
        }
    }

    /// Delete all sentences for a chapter (after conversion completes)
    pub async fn delete_chapter_sentences(
        pool: &SqlitePool,
        book_id: &str,
        chapter_index: usize,
    ) -> Result<(), String> {
        // Load all sentences first so we can delete their audio files
        let all_sentences = sqlx::query(
            "SELECT sentence_index, audio_file_path FROM live_sentence_alignment WHERE book_id = ? AND chapter_index = ?",
        )
        .bind(book_id)
        .bind(chapter_index as i64)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to query chapter sentences for cleanup: {}", e))?;

        // Delete audio files from disk
        for row in all_sentences {
            let audio_file_path: String = row.get("audio_file_path");
            if let Err(e) = std::fs::remove_file(&audio_file_path) {
                if std::path::Path::new(&audio_file_path).exists() {
                    log::warn!("Failed to delete checkpoint audio file {}: {}", audio_file_path, e);
                }
            }
        }

        // Delete from database
        sqlx::query(
            "DELETE FROM live_sentence_alignment WHERE book_id = ? AND chapter_index = ?",
        )
        .bind(book_id)
        .bind(chapter_index as i64)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to delete chapter sentences: {}", e))?;

        Ok(())
    }

    /// Delete all sentences for a book
    pub async fn delete_book_sentences(
        pool: &SqlitePool,
        book_id: &str,
    ) -> Result<(), String> {
        // Load all sentences first so we can delete their audio files
        let all_sentences = sqlx::query(
            "SELECT sentence_index, chapter_index, audio_file_path FROM live_sentence_alignment WHERE book_id = ?",
        )
        .bind(book_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to query sentences for cleanup: {}", e))?;

        // Delete audio files from disk
        for row in all_sentences {
            let audio_file_path: String = row.get("audio_file_path");
            if let Err(e) = std::fs::remove_file(&audio_file_path) {
                if std::path::Path::new(&audio_file_path).exists() {
                    log::warn!("Failed to delete checkpoint audio file {}: {}", audio_file_path, e);
                }
            }
        }

        // Delete from database
        sqlx::query("DELETE FROM live_sentence_alignment WHERE book_id = ?")
            .bind(book_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to delete book sentences: {}", e))?;

        Ok(())
    }

    /// Check if any checkpoints exist for a book (to determine if resume is available)
    pub async fn has_pending_checkpoints(
        pool: &SqlitePool,
        book_id: &str,
    ) -> Result<bool, String> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM live_conversion_checkpoint WHERE book_id = ?",
        )
        .bind(book_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to check for pending checkpoints: {}", e))?;

        Ok(count > 0)
    }

    /// Get all pending checkpoints for a book
    pub async fn get_pending_checkpoints(
        pool: &SqlitePool,
        book_id: &str,
    ) -> Result<Vec<ConversionCheckpoint>, String> {
        let rows = sqlx::query(
            r#"
            SELECT book_id, chapter_index, chapter_id, chapter_href, sentences_processed,
                   total_sentences, audio_duration_seconds, checkpoint_timestamp
            FROM live_conversion_checkpoint
            WHERE book_id = ?
            ORDER BY chapter_index
            "#,
        )
        .bind(book_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to get pending checkpoints: {}", e))?;

        Ok(rows
            .into_iter()
            .map(|r| ConversionCheckpoint {
                book_id: r.get("book_id"),
                chapter_index: r.get::<i64, _>("chapter_index") as usize,
                chapter_id: r.get("chapter_id"),
                chapter_href: r.get("chapter_href"),
                sentences_processed: r.get::<i64, _>("sentences_processed") as usize,
                total_sentences: r.get::<i64, _>("total_sentences") as usize,
                audio_duration_seconds: r.get("audio_duration_seconds"),
                checkpoint_timestamp: r.get("checkpoint_timestamp"),
            })
            .collect())
    }
}
