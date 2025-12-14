use serde::{Deserialize, Serialize};
use super::reader::VoiceId;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UITheme {
    #[serde(rename = "light")]
    Light,
    #[serde(rename = "dark")]
    Dark,
    #[serde(rename = "system")]
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: UITheme,
    pub tts_voice_id: VoiceId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_scroll_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_playback_speed: Option<f64>,
}
