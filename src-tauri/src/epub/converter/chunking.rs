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
// Pattern matches sentences ending with: . ! ? … (ellipsis U+2026) or multiple periods (...)
static SENTENCE_PATTERN: Lazy<Regex> = Lazy::new(|| {
    // Match sentences ending with: . ! ? … or ... (three periods)
    // The ellipsis character (U+2026) is included as a sentence ending
    Regex::new(r"([^.!?…]+(?:[.!?]+|…|\.\.\.))\s*")
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
    
    // Rebuild HTML properly by parsing it and inserting spans only around text nodes
    // This ensures we don't break HTML tag structure
    let mut in_body = false;
    let mut body_depth = 0;
    let mut html_pos = 0;
    let mut output = String::with_capacity(html.len() + sentences.len() * 50);
    
    // Build a map of sentence ranges
    let mut sentence_ranges: Vec<(usize, usize, usize)> = Vec::new(); // (start, end, sentence_idx)
    for (sentence_idx, span) in sentences_with_spans.iter().enumerate() {
        sentence_ranges.push((span.start_byte, span.end_byte, sentence_idx));
    }
    // Sort by start position
    sentence_ranges.sort_by_key(|(start, _, _)| *start);
    
    // Track which sentences are currently "open" (span opened but not yet closed)
    let mut open_spans: std::collections::HashSet<usize> = std::collections::HashSet::new();
    
    // Parse HTML and rebuild with spans inserted around text nodes
    for token in Tokenizer::from(html) {
        match token {
            Ok(Token::ElementStart { local, span, .. }) => {
                let local_str = local.as_str();
                if local_str.eq_ignore_ascii_case("body") {
                    in_body = true;
                    body_depth = 1;
                } else if in_body {
                    body_depth += 1;
                }
                // Output HTML before this token and the token itself
                let token_start = span.start();
                let token_end = span.end();
                output.push_str(&html[html_pos..token_start]);
                output.push_str(&html[token_start..token_end]);
                html_pos = token_end;
            }
            Ok(Token::ElementEnd { span, .. }) => {
                if in_body && body_depth > 0 {
                    body_depth -= 1;
                    if body_depth == 0 {
                        in_body = false;
                    }
                }
                // Output HTML before this token and the token itself
                let token_start = span.start();
                let token_end = span.end();
                output.push_str(&html[html_pos..token_start]);
                output.push_str(&html[token_start..token_end]);
                html_pos = token_end;
            }
            Ok(Token::Text { text }) => {
                let text_start = text.start();
                let text_end = text.end();
                
                // Output HTML before this text
                output.push_str(&html[html_pos..text_start]);
                
                if in_body {
                    // Find which sentences start or end within this text token
                    let mut spans_to_open: Vec<usize> = Vec::new();
                    let mut spans_to_close: Vec<usize> = Vec::new();
                    
                    for (sent_start, sent_end, sent_idx) in &sentence_ranges {
                        // Check if sentence overlaps with this text token
                        if *sent_start < text_end && *sent_end > text_start {
                            // Open span if sentence starts within or at the start of this text token
                            // and isn't already open
                            if *sent_start <= text_start && !open_spans.contains(sent_idx) {
                                spans_to_open.push(*sent_idx);
                                open_spans.insert(*sent_idx);
                            } else if *sent_start > text_start && *sent_start < text_end && !open_spans.contains(sent_idx) {
                                // Sentence starts in the middle of this text token
                                // We need to split the text, but htmlparser doesn't support that easily
                                // So we'll open the span at the start of the text token as an approximation
                                // This might create slightly larger spans, but won't break HTML structure
                                spans_to_open.push(*sent_idx);
                                open_spans.insert(*sent_idx);
                            }
                            // Close span if sentence ends within this text token
                            if *sent_end > text_start && *sent_end <= text_end && open_spans.contains(sent_idx) {
                                spans_to_close.push(*sent_idx);
                                open_spans.remove(sent_idx);
                            }
                        }
                    }
                    
                    // Sort spans to open/close in order
                    spans_to_open.sort();
                    spans_to_close.sort();
                    spans_to_close.reverse(); // Close in reverse order
                    
                    // Open spans
                    for sent_idx in spans_to_open {
                        let span_id = format!("f{:06}", sent_idx + 1);
                        output.push_str(&format!(r#"<span id="{}">"#, span_id));
                    }
                    
                    // Output the text itself
                    output.push_str(text.as_str());
                    
                    // Close spans
                    for sent_idx in spans_to_close {
                        output.push_str("</span>");
                    }
                } else {
                    // Not in body, just copy the text as-is
                    output.push_str(text.as_str());
                }
                
                html_pos = text_end;
            }
            Err(e) => {
                log::warn!("htmlparser error while rebuilding HTML: {:?}", e);
                // Continue processing, htmlparser will try to recover
            }
            _ => {
                // For other tokens (attributes, comments, etc.), htmlparser doesn't give us
                // direct access, but they're included in the raw HTML between tokens
                // So we don't need to handle them explicitly - they'll be in the gaps
            }
        }
    }
    
    // Output any remaining HTML and close any remaining open spans
    if html_pos < html.len() {
        output.push_str(&html[html_pos..]);
    }
    
    // Close any spans that are still open (shouldn't happen, but be safe)
    let mut remaining_spans: Vec<usize> = open_spans.iter().copied().collect();
    remaining_spans.sort();
    remaining_spans.reverse();
    for _sent_idx in remaining_spans {
        output.push_str("</span>");
    }
    
    let updated_html = output;
    
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
    // This maps each character in the combined text to its byte position in the original HTML
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
        sentence_matches.into_iter().map(|(sent_start, _sent_end, text)| {
            // Map from trimmed_text character positions to combined_text character positions
            let sent_start_chars = trimmed_text[..sent_start].chars().count();
            let sent_end_chars = sent_start_chars + text.chars().count();
            
            let start_in_combined = trim_offset_chars + sent_start_chars;
            let end_in_combined = trim_offset_chars + sent_end_chars;
            
            // Get HTML byte positions with better fallback handling
            let start_byte = char_to_html.get(start_in_combined)
                .and_then(|&pos| pos)
                .or_else(|| {
                    // Find the text part that contains this character position
                    let mut char_count = 0;
                    for (html_byte_pos, text_part) in text_parts.iter() {
                        let part_char_count = text_part.chars().count();
                        if char_count <= start_in_combined && start_in_combined < char_count + part_char_count {
                            // Calculate byte offset within this text part
                            let offset_in_part = start_in_combined - char_count;
                            let mut byte_offset = 0;
                            for (i, ch) in text_part.chars().enumerate() {
                                if i == offset_in_part {
                                    break;
                                }
                                byte_offset += ch.len_utf8();
                            }
                            return Some(*html_byte_pos + byte_offset);
                        }
                        char_count += part_char_count;
                    }
                    text_parts.first().map(|(pos, _)| *pos)
                })
                .unwrap_or(0);
            
            let end_byte = char_to_html.get(end_in_combined)
                .and_then(|&pos| pos)
                .or_else(|| {
                    // Find the text part that contains this character position
                    let mut char_count = 0;
                    for (html_byte_pos, text_part) in text_parts.iter() {
                        let part_char_count = text_part.chars().count();
                        if char_count <= end_in_combined && end_in_combined <= char_count + part_char_count {
                            // Calculate byte offset within this text part
                            let offset_in_part = end_in_combined - char_count;
                            let mut byte_offset = 0;
                            for (i, ch) in text_part.chars().enumerate() {
                                if i >= offset_in_part {
                                    break;
                                }
                                byte_offset += ch.len_utf8();
                            }
                            return Some(*html_byte_pos + byte_offset);
                        }
                        char_count += part_char_count;
                    }
                    text_parts.last().map(|(pos, text)| *pos + text.len())
                })
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


