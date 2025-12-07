use regex::Regex;
use htmlparser::{Tokenizer, Token};
use once_cell::sync::Lazy;
use crate::utils::errors::{ AppResult};

/// Sentence with its position in the original HTML
#[derive(Debug, Clone)]
pub struct SentenceWithSpan {
    pub text: String,
    pub start_byte: usize,
    pub end_byte: usize,
}

// Compile regex once at startup instead of on every call
static SENTENCE_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([^.!?]+[.!?]+)\s*")
        .expect("Failed to compile sentence regex pattern")
});

/// Extracts all text from HTML and adds span tags for text-audio synchronization.
///
/// This function:
/// 1. Extracts text from semantic elements (paragraphs, headings, list items, etc.)
/// 2. Wraps each sentence in a `<span>` tag with a unique ID
/// 3. Returns both the full text (for TTS) and updated HTML (for EPUB)
///
/// # Arguments
/// * `html` - The HTML content to process
///
/// # Returns
/// A tuple containing:
/// * `String` - Full extracted text for TTS generation (all sentences joined)
/// * `String` - Updated HTML with span tags for synchronization
/// * `Vec<(String, usize, usize)>` - List of (span_id, start_word_index, end_word_index) for mapping
///
pub fn extract_text_with_spans(html: &str, sentence_spans: Option<&[SentenceWithSpan]>) -> AppResult<(String, String, Vec<(String, usize, usize)>)> {
    // Use provided spans if available, otherwise extract them
    let sentences_with_spans = if let Some(spans) = sentence_spans {
        spans.to_vec()
    } else {
        extract_all_sentences(html)?
    };
    
    if sentences_with_spans.is_empty() {
        return Ok((String::new(), html.to_string(), Vec::new()));
    }
    
    // Extract just the sentence texts for compatibility
    let sentences: Vec<String> = sentences_with_spans.iter().map(|s| s.text.clone()).collect();
    
    let mut full_text = String::new();
    let mut span_mappings: Vec<(String, usize, usize)> = Vec::new();
    let mut current_word_index = 0;
    
    // Build full text and span mappings from the extracted sentences
    for (span_index, sentence) in sentences.iter().enumerate() {
        let span_id = format!("f{:06}", span_index + 1);
        
        // Count words in this sentence
        let word_count = crate::utils::text::count_words(sentence);
        let start_word = current_word_index;
        let end_word = current_word_index + word_count;
        
        // Add to full text
        if !full_text.is_empty() {
            full_text.push(' ');
        }
        full_text.push_str(sentence);
        current_word_index = end_word;
        
        // Track span mapping
        span_mappings.push((span_id, start_word, end_word));
    }
    
    // Now use the provided spans directly to wrap sentences - much simpler!
    let mut updated_html = html.to_string();
    let mut sentence_wraps: Vec<(usize, usize, usize)> = Vec::new(); // (start_html, end_html, sentence_idx)
    
    // Use the exact byte positions from the spans
    for (sentence_idx, span) in sentences_with_spans.iter().enumerate() {
        sentence_wraps.push((span.start_byte, span.end_byte, sentence_idx));
    }
    
    // Helper to find the nearest char boundary (for UTF-8 safety)
    fn find_char_boundary(s: &str, pos: usize) -> usize {
        if pos >= s.len() {
            return s.len();
        }
        // Find the start of the char containing this byte
        let mut pos = pos;
        while pos < s.len() && !s.is_char_boundary(pos) {
            pos -= 1;
        }
        pos
    }
    
    // Wrap sentences in reverse order to maintain positions
    for (start_html, end_html, sentence_idx) in sentence_wraps.into_iter().rev() {
        let span_id = format!("f{:06}", sentence_idx + 1);
        
        // Ensure we're at char boundaries
        let start_html = find_char_boundary(&updated_html, start_html);
        let end_html = find_char_boundary(&updated_html, end_html);
        
        // Check if already wrapped
        let before = &updated_html[..start_html];
        if !before.ends_with(&format!(r#"<span id="{}">"#, span_id)) {
            // Extract sentence HTML (preserving all tags)
            let sentence_html = &updated_html[start_html..end_html];
            
            // Wrap with span
            let wrapped = format!(r#"<span id="{}">{}</span>"#, span_id, sentence_html);
            updated_html.replace_range(start_html..end_html, &wrapped);
        }
    }
    
    log::debug!(
        "extract_text_with_spans: Processed {} sentences, added {} spans",
        sentences.len(),
        updated_html.matches(r#"<span id="f"#).count()
    );
    
    Ok((full_text, updated_html, span_mappings))
}

/// Extract all sentences from chapter content for round-robin TTS processing.
///
/// This function uses htmlparser to extract text with exact positions (StrSpan),
/// then splits it into sentences. Only extracts text from the `<body>` element.
///
/// # Arguments
/// * `html` - The HTML content to process
///
/// # Returns
/// A vector of sentences with their byte positions in the original HTML
pub fn extract_all_sentences(html: &str) -> AppResult<Vec<SentenceWithSpan>> {
    let sentence_pattern = &*SENTENCE_PATTERN;
    
    // Extract text using htmlparser, tracking positions
    // We'll collect text tokens and their positions
    let mut text_parts: Vec<(usize, &str)> = Vec::new(); // (byte_offset, text)
    let mut in_body = false;
    let mut body_depth = 0;
    let mut token_count = 0;
    let mut error_count = 0;
    
    // Track the element stack to know when we're exiting body
    let mut element_stack: Vec<String> = Vec::new();
    
    for token in Tokenizer::from(html) {
        token_count += 1;
        match token {
            Ok(Token::ElementStart { local, .. }) => {
                let local_str = local.as_str();
                log::debug!("ElementStart: {}", local_str);
                element_stack.push(local_str.to_string());
                if local_str.eq_ignore_ascii_case("body") {
                    in_body = true;
                    body_depth = 1;
                    log::debug!("Entered body, depth: {}", body_depth);
                } else if in_body {
                    body_depth += 1;
                    log::debug!("Inside body, depth increased to: {}", body_depth);
                }
            }
            Ok(Token::ElementEnd { end, .. }) => {
                // Check if this is a self-closing tag (end == ElementEnd::Open)
                // or a closing tag (end == ElementEnd::Close)
                use htmlparser::ElementEnd;
                match end {
                    ElementEnd::Open => {
                        // Self-closing tag (like <br/>), don't exit body for these
                        // Only pop from stack, but don't change body state
                        if !element_stack.is_empty() {
                            element_stack.pop();
                        }
                    }
                    ElementEnd::Close(local, _) => {
                        // Closing tag, check if it's body
                        let local_str = local.as_str();
                        log::debug!("ElementEnd::Close: {}", local_str);
                        if local_str.eq_ignore_ascii_case("body") && in_body {
                            in_body = false;
                            body_depth = 0;
                            log::debug!("Exited body (closing tag)");
                        } else if in_body && body_depth > 1 {
                            body_depth -= 1;
                            log::debug!("Inside body, depth decreased to: {} (closing tag: {})", body_depth, local_str);
                        }
                        // Pop from stack
                        if !element_stack.is_empty() {
                            element_stack.pop();
                        }
                    }
                    ElementEnd::Empty => {
                        // Empty element (like <br/>), don't exit body for these
                        // Only pop from stack, but don't change body state
                        if !element_stack.is_empty() {
                            element_stack.pop();
                        }
                    }
                }
            }
            Ok(Token::Text { text }) => {
                let text_str = text.as_str();
                log::debug!("Text token found: '{}' (in_body: {})", text_str.chars().take(50).collect::<String>(), in_body);
                if in_body {
                    text_parts.push((text.start(), text_str));
                }
            }
            Err(e) => {
                error_count += 1;
                log::warn!("htmlparser error: {:?}", e);
            }
            _ => {
                log::debug!("Other token: {:?}", token);
            }
        }
    }
    
    log::debug!("htmlparser: processed {} tokens, {} errors, {} text parts found", token_count, error_count, text_parts.len());
    
    // Combine all text parts
    let all_text: String = text_parts.iter().map(|(_, text)| *text).collect();
    
    // Trim the text and check if it's empty
    let trimmed_text = all_text.trim();
    if trimmed_text.is_empty() {
        log::debug!("No text found in HTML body");
        return Ok(Vec::new());
    }
    
    // Build mapping from character positions in combined_text to HTML byte positions
    let mut char_to_html: Vec<Option<usize>> = Vec::new();
    for (html_byte_pos, text) in text_parts.iter() {
        let mut byte_offset = 0;
        for ch in text.chars() {
            char_to_html.push(Some(*html_byte_pos + byte_offset));
            byte_offset += ch.len_utf8();
        }
    }
    
    // Find where trimmed_text starts in combined_text
    let trim_offset = all_text.find(trimmed_text).unwrap_or(0);
    let trim_offset_chars = all_text[..trim_offset].chars().count();
    
    // Split into sentences and map to HTML positions
    let sentence_matches: Vec<(usize, usize, &str)> = sentence_pattern
        .find_iter(trimmed_text)
        .map(|m| {
            let start = m.start();
            let end = m.end();
            let text = m.as_str().trim();
            (start, end, text)
        })
        .filter(|(_, _, text)| !text.is_empty())
        .collect();
    
    let all_sentences: Vec<SentenceWithSpan> = if sentence_matches.is_empty() {
        // If no sentences found but text exists, treat the whole text as one sentence
        let start_chars = trim_offset_chars;
        let end_chars = start_chars + trimmed_text.chars().count();
        let start_byte = char_to_html.get(start_chars).and_then(|&pos| pos)
            .or_else(|| text_parts.first().map(|(pos, _)| *pos))
            .unwrap_or(0);
        let end_byte = char_to_html.get(end_chars).and_then(|&pos| pos)
            .or_else(|| text_parts.last().map(|(pos, text)| *pos + text.len()))
            .unwrap_or(html.len());
        vec![SentenceWithSpan {
            text: trimmed_text.to_string(),
            start_byte,
            end_byte,
        }]
    } else {
        sentence_matches.into_iter().map(|(sent_start, sent_end, text)| {
            // Map from trimmed_text character positions to combined_text character positions
            let sent_start_chars = trimmed_text[..sent_start].chars().count();
            let sent_end_chars = sent_start_chars + text.chars().count();
            
            let start_in_combined = trim_offset_chars + sent_start_chars;
            let end_in_combined = trim_offset_chars + sent_end_chars;
            
            // Get HTML byte positions
            let start_byte = char_to_html.get(start_in_combined).and_then(|&pos| pos)
                .or_else(|| text_parts.first().map(|(pos, _)| *pos))
                .unwrap_or(0);
            let end_byte = char_to_html.get(end_in_combined).and_then(|&pos| pos)
                .or_else(|| text_parts.last().map(|(pos, text)| *pos + text.len()))
                .unwrap_or(html.len());
            
            SentenceWithSpan {
                text: text.to_string(),
                start_byte,
                end_byte,
            }
        }).collect()
    };
    
    log::debug!("Extracted {} sentences from HTML body", all_sentences.len());
    
    Ok(all_sentences)
}


