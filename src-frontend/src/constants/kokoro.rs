use crate::types::reader::VoiceId;

pub const DEFAULT_KOKORO_MODEL_ID: &str = "onnx-community/Kokoro-82M-v1.0-ONNX";
pub const DEFAULT_KOKORO_VOICE_ID_STR: &str = "af_heart";

pub fn default_kokoro_voice_id() -> VoiceId {
    DEFAULT_KOKORO_VOICE_ID_STR.to_string()
}
pub const KOKORO_MODEL_CARD_URL: &str = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX";
pub const KOKORO_VOICE_DATASET_URL: &str = "https://huggingface.co/datasets/hexgrad/Kokoro-voices";

#[derive(Debug, Clone, PartialEq)]
pub struct KokoroVoiceOption {
    pub id: VoiceId,
    pub name: String,
    pub gender: String, // "Female" | "Male"
    pub language_tag: String,
    pub summary: String,
    pub sample_url: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KokoroVoiceGroup {
    pub label: String,
    pub voices: Vec<KokoroVoiceOption>,
}

pub fn get_kokoro_voice_groups() -> Vec<KokoroVoiceGroup> {
    vec![
        KokoroVoiceGroup {
            label: "American English".to_string(),
            voices: vec![
                KokoroVoiceOption {
                    id: "af_heart".to_string(),
                    name: "Heart".to_string(),
                    gender: "Female".to_string(),
                    language_tag: "en-US".to_string(),
                    summary: "Expressive default, Grade A".to_string(),
                    sample_url: "voice-samples/af_heart.mp3".to_string(),
                },
                KokoroVoiceOption {
                    id: "af_bella".to_string(),
                    name: "Bella".to_string(),
                    gender: "Female".to_string(),
                    language_tag: "en-US".to_string(),
                    summary: "Warm storyteller, Grade A-".to_string(),
                    sample_url: "voice-samples/af_bella.mp3".to_string(),
                },
                KokoroVoiceOption {
                    id: "af_jessica".to_string(),
                    name: "Jessica".to_string(),
                    gender: "Female".to_string(),
                    language_tag: "en-US".to_string(),
                    summary: "Soft conversational, Grade D".to_string(),
                    sample_url: "voice-samples/af_jessica.mp3".to_string(),
                },
                KokoroVoiceOption {
                    id: "am_fenrir".to_string(),
                    name: "Fenrir".to_string(),
                    gender: "Male".to_string(),
                    language_tag: "en-US".to_string(),
                    summary: "Deep & bold, Grade C+".to_string(),
                    sample_url: "voice-samples/am_fenrir.mp3".to_string(),
                },
                KokoroVoiceOption {
                    id: "am_michael".to_string(),
                    name: "Michael".to_string(),
                    gender: "Male".to_string(),
                    language_tag: "en-US".to_string(),
                    summary: "Presenter feel, Grade C+".to_string(),
                    sample_url: "voice-samples/am_michael.mp3".to_string(),
                },
            ],
        },
        KokoroVoiceGroup {
            label: "British English".to_string(),
            voices: vec![
                KokoroVoiceOption {
                    id: "bf_emma".to_string(),
                    name: "Emma".to_string(),
                    gender: "Female".to_string(),
                    language_tag: "en-GB".to_string(),
                    summary: "Premium narrator, Grade B-".to_string(),
                    sample_url: "voice-samples/bf_emma.mp3".to_string(),
                },
                KokoroVoiceOption {
                    id: "bf_isabella".to_string(),
                    name: "Isabella".to_string(),
                    gender: "Female".to_string(),
                    language_tag: "en-GB".to_string(),
                    summary: "Polished neutral, Grade C".to_string(),
                    sample_url: "voice-samples/bf_isabella.mp3".to_string(),
                },
                KokoroVoiceOption {
                    id: "bm_fable".to_string(),
                    name: "Fable".to_string(),
                    gender: "Male".to_string(),
                    language_tag: "en-GB".to_string(),
                    summary: "Dramatic baritone, Grade C".to_string(),
                    sample_url: "voice-samples/bm_fable.mp3".to_string(),
                },
                KokoroVoiceOption {
                    id: "bm_george".to_string(),
                    name: "George".to_string(),
                    gender: "Male".to_string(),
                    language_tag: "en-GB".to_string(),
                    summary: "Clean RP read, Grade C".to_string(),
                    sample_url: "voice-samples/bm_george.mp3".to_string(),
                },
            ],
        },
    ]
}
