//! WebVTT (VTT) subtitle file generation for audiobooks
//!
//! This module generates VTT files for individual chapters and a combined
//! VTT file for the entire book, using word alignments from TTS generation.

use kokoros::tts::koko::WordAlignment;

/// Format a time in seconds to WebVTT time format (HH:MM:SS.mmm)
fn format_vtt_time(seconds: f64) -> String {
    let total_ms = (seconds * 1000.0) as u64;
    let hours = total_ms / 3_600_000;
    let minutes = (total_ms % 3_600_000) / 60_000;
    let secs = (total_ms % 60_000) / 1000;
    let millis = total_ms % 1000;

    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, secs, millis)
}

/// Generate a VTT file for a single chapter using word alignments
///
/// # Arguments
/// * `word_alignments` - Word alignments with timing information
/// * `chapter_title` - Title of the chapter (for header)
///
/// # Returns
/// VTT file content as a string
pub(crate) fn generate_chapter_vtt(
    word_alignments: &[WordAlignment],
    chapter_title: &str,
) -> String {
    let mut vtt = String::new();

    // VTT header
    vtt.push_str("WEBVTT\n");
    vtt.push_str("\n");
    vtt.push_str(&format!("NOTE Chapter: {}\n", chapter_title));
    vtt.push_str("\n");

    if word_alignments.is_empty() {
        return vtt;
    }

    // Group words into cues (sentences/phrases)
    // For now, we'll create cues for each word, but we can group them later
    // if needed for better readability
    let mut current_cue_words = Vec::new();
    let mut current_start = word_alignments[0].start_sec as f64;
    let mut current_end = word_alignments[0].end_sec as f64;

    for (idx, alignment) in word_alignments.iter().enumerate() {
        let is_punctuation = alignment
            .word
            .chars()
            .all(|c| c.is_ascii_punctuation() || c.is_whitespace());

        // Start a new cue if:
        // 1. We hit punctuation that ends a sentence (. ! ?)
        // 2. There's a significant gap between words (> 0.5 seconds)
        // 3. We've accumulated too many words (> 10 words per cue for readability)
        let should_break = is_punctuation
            && (alignment.word.contains('.')
                || alignment.word.contains('!')
                || alignment.word.contains('?'))
            || (idx > 0 && (alignment.start_sec as f64) - current_end > 0.5)
            || current_cue_words.len() >= 10;

        if should_break && !current_cue_words.is_empty() {
            // Write the current cue
            let text = current_cue_words.join(" ");
            vtt.push_str(&format!(
                "{} --> {}\n",
                format_vtt_time(current_start),
                format_vtt_time(current_end)
            ));
            vtt.push_str(&format!("{}\n", text));
            vtt.push_str("\n");
            
            // Start a new cue
            current_cue_words.clear();
            current_start = alignment.start_sec as f64;
        }
        
        // Add word to current cue
        if !is_punctuation || !current_cue_words.is_empty() {
            current_cue_words.push(alignment.word.clone());
        }
        current_end = alignment.end_sec as f64;
    }

    // Write the last cue if there are remaining words
    if !current_cue_words.is_empty() {
        let text = current_cue_words.join(" ");
        vtt.push_str(&format!(
            "{} --> {}\n",
            format_vtt_time(current_start),
            format_vtt_time(current_end)
        ));
        vtt.push_str(&format!("{}\n", text));
        vtt.push_str("\n");
    }

    vtt
}

/// Generate a combined VTT file for the entire book
///
/// # Arguments
/// * `chapters` - Vector of (chapter_title, word_alignments, chapter_start_time) tuples
///   where chapter_start_time is the cumulative time offset for this chapter
///
/// # Returns
/// Combined VTT file content as a string
pub(crate) fn generate_book_vtt(chapters: &[(String, Vec<WordAlignment>, f64)]) -> String {
    let mut vtt = String::new();

    // VTT header
    vtt.push_str("WEBVTT\n");
    vtt.push_str("\n");
    vtt.push_str("NOTE Complete audiobook with all chapters\n");
    vtt.push_str("\n");

    let mut cumulative_time = 0.0;

    for (chapter_title, word_alignments, chapter_start_time) in chapters {
        // Add chapter marker
        vtt.push_str(&format!("NOTE Chapter: {}\n", chapter_title));
        vtt.push_str("\n");

        if word_alignments.is_empty() {
            continue;
        }

        // Generate cues for this chapter with offset
        let mut current_cue_words = Vec::new();
        let mut current_start = chapter_start_time + word_alignments[0].start_sec as f64;
        let mut current_end = chapter_start_time + word_alignments[0].end_sec as f64;

        for (idx, alignment) in word_alignments.iter().enumerate() {
            let is_punctuation = alignment
                .word
                .chars()
                .all(|c| c.is_ascii_punctuation() || c.is_whitespace());

            let word_start = chapter_start_time + alignment.start_sec as f64;
            let word_end = chapter_start_time + alignment.end_sec as f64;

            let should_break = is_punctuation
                && (alignment.word.contains('.')
                    || alignment.word.contains('!')
                    || alignment.word.contains('?'))
                || (idx > 0 && word_start - current_end > 0.5)
                || current_cue_words.len() >= 10;

            if should_break && !current_cue_words.is_empty() {
                // Write the current cue
                let text = current_cue_words.join(" ");
                vtt.push_str(&format!(
                    "{} --> {}\n",
                    format_vtt_time(current_start),
                    format_vtt_time(current_end)
                ));
                vtt.push_str(&format!("{}\n", text));
                vtt.push_str("\n");

                // Start a new cue
                current_cue_words.clear();
                current_start = word_start;
            }

            // Add word to current cue
            if !is_punctuation || !current_cue_words.is_empty() {
                current_cue_words.push(alignment.word.clone());
            }
            current_end = word_end;
        }

        // Write the last cue for this chapter if there are remaining words
        if !current_cue_words.is_empty() {
            let text = current_cue_words.join(" ");
            vtt.push_str(&format!(
                "{} --> {}\n",
                format_vtt_time(current_start),
                format_vtt_time(current_end)
            ));
            vtt.push_str(&format!("{}\n", text));
            vtt.push_str("\n");
        }

        // Update cumulative time for next chapter
        if let Some(last_alignment) = word_alignments.last() {
            cumulative_time = chapter_start_time + last_alignment.end_sec as f64;
        }
    }

    vtt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_vtt_time() {
        assert_eq!(format_vtt_time(0.0), "00:00:00.000");
        assert_eq!(format_vtt_time(1.5), "00:00:01.500");
        assert_eq!(format_vtt_time(65.123), "00:01:05.123");
        assert_eq!(format_vtt_time(3661.456), "01:01:01.456");
    }

    #[test]
    fn test_generate_chapter_vtt() {
        let alignments = vec![
            WordAlignment {
                word: "Hello".to_string(),
                start_sec: 0.0,
                end_sec: 0.5,
            },
            WordAlignment {
                word: "world".to_string(),
                start_sec: 0.5,
                end_sec: 1.0,
            },
        ];

        let vtt = generate_chapter_vtt(&alignments, "Test Chapter");
        assert!(vtt.contains("WEBVTT"));
        assert!(vtt.contains("Test Chapter"));
        assert!(vtt.contains("00:00:00.000"));
    }
}
