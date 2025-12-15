use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConversionProgress {
    pub current_chapter: usize,
    pub total_chapters: usize,
    pub words_processed: usize,
    pub total_words: usize,
    pub words_in_current_chapter: usize,
    pub current_step: ConversionStep,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ConversionStep {
    Initializing,
    GeneratingAudio,
    ConvertingAudio,
    CreatingSmil,
    SavingEpub,
    Skipping,
    Completed,
    Complete,
}

// Raw payload type that can come from Rust in either camelCase or snake_case
#[derive(Debug, Clone, Deserialize)]
pub struct ConversionProgressPayload {
    #[serde(alias = "currentChapter")]
    pub current_chapter: Option<usize>,
    #[serde(alias = "totalChapters")]
    pub total_chapters: Option<usize>,
    #[serde(alias = "wordsProcessed")]
    pub words_processed: Option<usize>,
    #[serde(alias = "totalWords")]
    pub total_words: Option<usize>,
    #[serde(alias = "wordsInCurrentChapter")]
    pub words_in_current_chapter: Option<usize>,
    #[serde(alias = "currentStep")]
    pub current_step: Option<String>,
    pub message: Option<String>,
    // Optional: source_path or book_id to identify which book this progress is for
    #[serde(alias = "sourcePath")]
    pub source_path: Option<String>,
    #[serde(alias = "bookId")]
    pub book_id: Option<String>,
}

impl From<ConversionProgressPayload> for ConversionProgress {
    fn from(payload: ConversionProgressPayload) -> Self {
        let current_step = payload.current_step
            .as_ref()
            .and_then(|s| match s.as_str() {
                "initializing" => Some(ConversionStep::Initializing),
                "generating-audio" => Some(ConversionStep::GeneratingAudio),
                "converting-audio" => Some(ConversionStep::ConvertingAudio),
                "creating-smil" => Some(ConversionStep::CreatingSmil),
                "saving-epub" => Some(ConversionStep::SavingEpub),
                "skipping" => Some(ConversionStep::Skipping),
                "completed" => Some(ConversionStep::Completed),
                "complete" => Some(ConversionStep::Complete),
                _ => Some(ConversionStep::Initializing),
            })
            .unwrap_or(ConversionStep::Initializing);
        
        ConversionProgress {
            current_chapter: payload.current_chapter.unwrap_or(0),
            total_chapters: payload.total_chapters.unwrap_or(0),
            words_processed: payload.words_processed.unwrap_or(0),
            total_words: payload.total_words.unwrap_or(0),
            words_in_current_chapter: payload.words_in_current_chapter.unwrap_or(0),
            current_step,
            message: payload.message.unwrap_or_default(),
        }
    }
}


