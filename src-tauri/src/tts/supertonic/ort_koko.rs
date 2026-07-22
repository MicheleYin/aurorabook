use crate::tts::supertonic::core::{load_text_to_speech, TextToSpeech};

/// Holds the Supertonic ONNX pipeline (duration, text encoder, vector estimator, vocoder).
pub struct OrtKoko {
    pub tts: TextToSpeech,
}

impl OrtKoko {
    /// `onnx_dir` must contain `tts.json`, `unicode_indexer.json`, and the four `.onnx` model files.
    pub fn new(onnx_dir: String) -> Result<Self, String> {
        let tts = load_text_to_speech(&onnx_dir, false).map_err(|e| e.to_string())?;
        Ok(Self { tts })
    }
}
