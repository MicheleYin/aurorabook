/// Extract published year from date string
pub fn extract_year(date: Option<&String>) -> Option<String> {
    date.and_then(|d| {
        d.chars()
            .filter(|c| c.is_ascii_digit())
            .take(4)
            .collect::<String>()
            .parse::<String>()
            .ok()
            .filter(|s| s.len() == 4)
    })
}

/// Derive title from file path
pub fn derive_title_from_path(path: &str) -> String {
    path.split('/')
        .last()
        .unwrap_or("Unknown")
        .replace(".epub", "")
        .to_string()
}

/// Generate audio track title from filename
pub fn generate_audio_track_title(filename: &str, index: usize) -> String {
    let decoded = filename.replace("%20", " ").replace("%2D", "-");
    let base_title = decoded
        .replace(".mp3", "")
        .replace(".wav", "")
        .replace(".m4a", "")
        .replace("_", " ")
        .replace("-", " ")
        .trim()
        .to_string();
    
    if base_title.is_empty() {
        format!("Track {}", index + 1)
    } else {
        base_title
    }
}

