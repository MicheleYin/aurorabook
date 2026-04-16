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
    Regex::new(r"([^.!?…]+(?:[.!?]+|…))\s*")
        .expect("Failed to compile sentence regex pattern")
});

const MIN_SENTENCE_WORDS: usize = 10;
const MIN_SENTENCE_ALNUM_CHARS: usize = 20;

fn is_too_short_sentence(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }

    let word_count = crate::utils::text::count_words(trimmed);
    let alnum_char_count = trimmed.chars().filter(|c| c.is_alphanumeric()).count();

    word_count < MIN_SENTENCE_WORDS || alnum_char_count < MIN_SENTENCE_ALNUM_CHARS
}

/// Two adjacent sentences may only be merged when their HTML byte ranges are not separated by
/// markup. Otherwise `extract_text_with_spans` closes spans at element boundaries and the merged
/// `SentenceWithSpan` (one `start_byte`/`end_byte` covering both) no longer matches span `id`s in
/// the rebuilt HTML — breaking sentence-id lookup for highlighting.
fn can_merge_adjacent_in_html(html: &str, left: &SentenceWithSpan, right: &SentenceWithSpan) -> bool {
    if left.end_byte > right.start_byte {
        return false;
    }
    if left.end_byte > html.len() || right.start_byte > html.len() {
        return false;
    }
    !html[left.end_byte..right.start_byte].contains('<')
}

/// Merge short sentence fragments into neighboring sentences.
///
/// Strategy:
/// 1. Prefer merging into previous sentence (parent context) when possible.
/// 2. If fragment is first sentence, merge into next sentence.
/// 3. If merging with previous is impossible (markup between), try merging into the next sentence.
/// 4. Retry until no mergeable short fragments remain.
fn merge_short_sentences(html: &str, mut sentences: Vec<SentenceWithSpan>) -> Vec<SentenceWithSpan> {
    if sentences.len() <= 1 {
        return sentences;
    }

    let mut merged_count = 0usize;
    let mut idx = 0usize;

    while idx < sentences.len() {
        if !is_too_short_sentence(&sentences[idx].text) {
            idx += 1;
            continue;
        }

        if sentences.len() <= 1 {
            break;
        }

        let mut merged = false;

        if idx > 0 {
            let (prev, cur) = (&sentences[idx - 1], &sentences[idx]);
            if can_merge_adjacent_in_html(html, prev, cur) {
                let short = sentences.remove(idx);
                let previous = &mut sentences[idx - 1];
                previous.text = format!(
                    "{} {}",
                    previous.text.trim_end(),
                    short.text.trim_start()
                )
                .trim()
                .to_string();
                previous.end_byte = previous.end_byte.max(short.end_byte);
                merged_count += 1;
                merged = true;
                idx = idx.saturating_sub(1);
            }
        }

        if merged {
            continue;
        }

        if idx + 1 < sentences.len() {
            let (cur, next) = (&sentences[idx], &sentences[idx + 1]);
            if can_merge_adjacent_in_html(html, cur, next) {
                let next = sentences.remove(idx + 1);
                let current = &mut sentences[idx];
                current.text = format!("{} {}", current.text.trim_end(), next.text.trim_start())
                    .trim()
                    .to_string();
                current.end_byte = current.end_byte.max(next.end_byte);
                merged_count += 1;
                continue;
            }
        }

        idx += 1;
    }

    if merged_count > 0 {
        log::debug!(
            "Merged {} short sentence fragment(s) using adjacent context",
            merged_count
        );
    }

    sentences
}

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
    
    // Parse HTML and insert spans around text content
    // Simplified strategy:
    // 1. Open a span when we encounter the start of a sentence in a text token
    // 2. Close a span when we encounter the end of a sentence in a text token
    // 3. When an element closes, close any open span (prevents spans leaking across boundaries)
    // 4. Only track if a span is open - this is the single source of truth
    
    let mut html_pos = 0;
    let mut output = String::with_capacity(html.len() + sentences.len() * 50);
    
    // Single source of truth: is a span currently open in the output?
    let mut span_is_open = false;
    
    // Track if we are inside the body element
    let mut in_body = false;
    
    // Track HTML element stack (for validation, not span management)
    let mut element_stack: Vec<String> = Vec::new();
    
    for token in Tokenizer::from(html) {
        match token {
            Ok(Token::ElementStart { local, span, .. }) => {
                // Output HTML before this token
                output.push_str(&html[html_pos..span.start()]);
                
                // Check if this is a self-closing tag (like <a id="page-1"/>)
                // Self-closing tags don't need to be tracked in the stack
                let element_str = &html[span.start()..span.end()];
                let is_self_closing = element_str.ends_with("/>") || element_str.ends_with(" />");
                
                // Only push to stack if not self-closing
                if !is_self_closing {
                    let element_name = local.as_str().to_string();
                    if element_name.eq_ignore_ascii_case("body") {
                        in_body = true;
                    }
                    element_stack.push(element_name);
                }
                
                // Output the element start tag
                output.push_str(element_str);
                html_pos = span.end();
            }
            Ok(Token::ElementEnd { end, span, .. }) => {
                use htmlparser::ElementEnd;
                
                // Output HTML before this token
                output.push_str(&html[html_pos..span.start()]);
                
                // Check if this is a closing tag
                if let ElementEnd::Close(closing_local, _) = end {
                    let closing_name = closing_local.as_str();
                    
                    // Close any open span before element closes (prevents spans leaking across boundaries)
                    if span_is_open {
                        output.push_str("</span>");
                        span_is_open = false;
                    }
                    
                    // Find and remove matching opening tag from stack
                    if let Some(stack_pos) = element_stack.iter().rposition(|name| name.eq_ignore_ascii_case(closing_name)) {
                        let name = element_stack.remove(stack_pos);
                        if name.eq_ignore_ascii_case("body") {
                            in_body = false;
                        }
                    }
                }
                
                // Output the element end tag
                output.push_str(&html[span.start()..span.end()]);
                html_pos = span.end();
            }
            Ok(Token::Text { text }) => {
                let text_start = text.start();
                let text_end = text.end();
                let text_content = text.as_str();
                
                // Output HTML before this text token
                output.push_str(&html[html_pos..text_start]);
                
                // Only process spans for content in the body
                if in_body {
                    // Find all sentences that overlap with this text token, sorted by start position
                    let mut relevant_sentences: Vec<(usize, &SentenceWithSpan)> = sentences_with_spans
                        .iter()
                        .enumerate()
                        .filter(|(_, span_data)| {
                            // Sentence overlaps if it starts before token ends and ends after token starts
                            span_data.start_byte < text_end && span_data.end_byte > text_start
                        })
                        .collect();
                    relevant_sentences.sort_by_key(|(_, span_data)| span_data.start_byte);
                    
                    if relevant_sentences.is_empty() {
                        // No sentences in this token - just output text
                        // Don't close spans here - let element closing or next token handle it
                        // This prevents premature closing
                        output.push_str(text_content);
                    } else {
                        // Process sentences in order
                        let mut pos_in_token = 0;
                        
                        for (sent_idx, span_data) in relevant_sentences {
                            // Determine boundaries within this token
                            let sent_start_in_token = if span_data.start_byte >= text_start {
                                span_data.start_byte - text_start
                            } else {
                                0 // Sentence started before this token
                            };
                            
                            let sent_end_in_token = if span_data.end_byte <= text_end {
                                span_data.end_byte - text_start
                            } else {
                                text_content.len() // Sentence continues beyond this token
                            };
                            
                            // Output any text before this sentence starts
                            if sent_start_in_token > pos_in_token {
                                let slice = &text_content[pos_in_token..sent_start_in_token.min(text_content.len())];
                                output.push_str(slice);
                                pos_in_token = sent_start_in_token;
                            }
                            
                            // Close any open span before starting a new one
                            if span_is_open {
                                output.push_str("</span>");
                                span_is_open = false;
                            }
                            
                            // Open sentence span:
                            // 1. If it's newly starting in this token
                            // 2. OR if it started before but we aren't currently in an open span (continuity)
                            if !span_is_open {
                                let span_id = format!("f{:06}", sent_idx + 1);
                                output.push_str(&format!(r#"<span id="{}">"#, span_id));
                                span_is_open = true;
                            }
                            
                            // Output text for this sentence
                            if sent_end_in_token > pos_in_token {
                                let slice = &text_content[pos_in_token..sent_end_in_token.min(text_content.len())];
                                output.push_str(slice);
                                pos_in_token = sent_end_in_token;
                            }
                            
                            // Close sentence if it ends in this token
                            if span_data.end_byte > text_start && span_data.end_byte <= text_end && span_is_open {
                                output.push_str("</span>");
                                span_is_open = false;
                            }
                        }
                        
                        // Output any remaining text after the last sentence
                        if pos_in_token < text_content.len() {
                            let slice = &text_content[pos_in_token..];
                            output.push_str(slice);
                        }
                    }
                } else {
                    // Not in body - just output text
                    output.push_str(text_content);
                }
                
                html_pos = text_end;
            }
            Err(e) => {
                log::warn!("htmlparser error while rebuilding HTML: {:?}", e);
            }
            _ => {}
        }
    }
    
    // Output any remaining HTML
    if html_pos < html.len() {
        output.push_str(&html[html_pos..]);
    }
    
    // Close any remaining open spans
    if span_is_open {
        output.push_str("</span>");
        span_is_open = false;
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

/// Represents a text segment extracted from HTML with its exact position
#[derive(Debug, Clone)]
struct TextSegment {
    /// The text content
    text: String,
    /// Start byte position in HTML
    html_start: usize,
    /// End byte position in HTML
    html_end: usize,
    /// Start byte position in the combined text (after concatenating all segments)
    combined_start: usize,
    /// End byte position in the combined text
    combined_end: usize,
    /// ID of the block this segment belongs to
    block_id: usize,
}

fn is_inline_tag(tag: &str) -> bool {
    match tag.to_lowercase().as_str() {
        "a" | "b" | "i" | "em" | "strong" | "span" | "sub" | "sup" | "u" | "code" | "mark" | "cite" | "q" | "br" | "small" | "big" | "font" => true,
        _ => false
    }
}

pub fn extract_all_sentences(html: &str) -> AppResult<Vec<SentenceWithSpan>> {
    let sentence_pattern = &*SENTENCE_PATTERN;
    
    // Extract text segments from HTML body, tracking their exact positions
    let mut text_segments: Vec<TextSegment> = Vec::new();
    let mut in_body = false;
    let mut body_depth = 0;
    let mut combined_byte_pos = 0;
    
    let mut current_block_id = 0;
    
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

                // If it's a block tag and we're in the body, increment block ID
                if in_body && !is_inline_tag(local_str) {
                    current_block_id += 1;
                }
            }
            Ok(Token::ElementEnd { end, .. }) => {
                use htmlparser::ElementEnd;
                match end {
                    ElementEnd::Close(local, _) => {
                        let local_str = local.as_str();
                        if local_str.eq_ignore_ascii_case("body") && in_body {
                            in_body = false;
                            body_depth = 0;
                        } else if in_body && body_depth > 1 {
                            body_depth -= 1;
                        }

                        // If it's a block tag and we're in the body, increment block ID
                        if in_body && !is_inline_tag(local_str) {
                            current_block_id += 1;
                        }
                    }
                    _ => {
                        if in_body && body_depth > 0 {
                            body_depth -= 1;
                        }
                    }
                }
            }
            Ok(Token::Text { text }) => {
                if in_body {
                    let text_str = text.as_str();
                    let html_start = text.start();
                    let html_end = text.end();
                    let text_len = text_str.len();
                    
                    text_segments.push(TextSegment {
                        text: text_str.to_string(),
                        html_start,
                        html_end,
                        combined_start: combined_byte_pos,
                        combined_end: combined_byte_pos + text_len,
                        block_id: current_block_id,
                    });
                    
                    combined_byte_pos += text_len;
                }
            }
            Err(e) => {
                log::warn!("htmlparser error: {:?}", e);
            }
            _ => {}
        }
    }
    
    if text_segments.is_empty() {
        return Ok(Vec::new());
    }
    
    // Helper: map a byte position in combined text to HTML byte position
    let map_to_html = |combined_pos: usize, segments: &[TextSegment]| -> Option<usize> {
        if segments.is_empty() { return None; }
        // Handle exact end of the last segment
        if combined_pos == segments.last().unwrap().combined_end {
            return Some(segments.last().unwrap().html_end);
        }
        
        for seg in segments {
            if combined_pos >= seg.combined_start && combined_pos < seg.combined_end {
                let offset_in_seg = combined_pos - seg.combined_start;
                return Some(seg.html_start + offset_in_seg);
            }
        }
        None
    };
    
    // Group segments by block_id and process each block separately
    let mut all_sentences: Vec<SentenceWithSpan> = Vec::new();
    if text_segments.is_empty() {
        return Ok(Vec::new());
    }

    let mut start_idx = 0;
    while start_idx < text_segments.len() {
        let block_id = text_segments[start_idx].block_id;
        let mut end_idx = start_idx + 1;
        while end_idx < text_segments.len() && text_segments[end_idx].block_id == block_id {
            end_idx += 1;
        }

        // text_segments[start_idx..end_idx] is the current block
        let block_segments = &text_segments[start_idx..end_idx];
        let block_text: String = block_segments.iter().map(|s| s.text.as_str()).collect();
        let trimmed_block = block_text.trim();

        if !trimmed_block.is_empty() {
            let block_offset = block_text.find(trimmed_block).unwrap_or(0);
            let mut last_match_end = 0;

            for m in sentence_pattern.find_iter(trimmed_block) {
                // Gap before match
                let gap_text = &trimmed_block[last_match_end..m.start()];
                let trimmed_gap = gap_text.trim();
                if !trimmed_gap.is_empty() {
                    let start_in_block = last_match_end + gap_text.find(trimmed_gap).unwrap_or(0);
                    let start_combined = block_segments[0].combined_start + block_offset + start_in_block;
                    let end_combined = start_combined + trimmed_gap.len();
                    
                    let start_byte = map_to_html(start_combined, block_segments).unwrap_or(0);
                    let end_byte = map_to_html(end_combined, block_segments).unwrap_or(html.len());
                    
                    all_sentences.push(SentenceWithSpan {
                        text: trimmed_gap.to_string(),
                        start_byte,
                        end_byte,
                    });
                }

                // The match itself
                let match_text = m.as_str();
                let trimmed_match = match_text.trim();
                if !trimmed_match.is_empty() {
                    let start_in_block = m.start() + match_text.find(trimmed_match).unwrap_or(0);
                    let start_combined = block_segments[0].combined_start + block_offset + start_in_block;
                    let end_combined = start_combined + trimmed_match.len();
                    
                    let start_byte = map_to_html(start_combined, block_segments).unwrap_or(0);
                    let end_byte = map_to_html(end_combined, block_segments).unwrap_or(html.len());
                    
                    all_sentences.push(SentenceWithSpan {
                        text: trimmed_match.to_string(),
                        start_byte,
                        end_byte,
                    });
                }
                last_match_end = m.end();
            }

            // Remaining text in block
            let remaining_text = &trimmed_block[last_match_end..];
            let trimmed_remaining = remaining_text.trim();
            if !trimmed_remaining.is_empty() {
                let start_in_block = last_match_end + remaining_text.find(trimmed_remaining).unwrap_or(0);
                let start_combined = block_segments[0].combined_start + block_offset + start_in_block;
                let end_combined = start_combined + trimmed_remaining.len();
                
                let start_byte = map_to_html(start_combined, block_segments).unwrap_or(0);
                let end_byte = map_to_html(end_combined, block_segments).unwrap_or(html.len());
                
                all_sentences.push(SentenceWithSpan {
                    text: trimmed_remaining.to_string(),
                    start_byte,
                    end_byte,
                });
            }
        }

        start_idx = end_idx;
    }

    if all_sentences.is_empty() {
        // Find the full trimmed text for a final fallback if nothing was extracted from blocks
        let all_text: String = text_segments.iter().map(|seg| seg.text.as_str()).collect();
        let trimmed_all = all_text.trim();
        if !trimmed_all.is_empty() {
            let trim_offset = all_text.find(trimmed_all).unwrap_or(0);
            let start_byte = map_to_html(trim_offset, &text_segments).unwrap_or(0);
            let end_byte = map_to_html(trim_offset + trimmed_all.len(), &text_segments).unwrap_or(html.len());
            all_sentences.push(SentenceWithSpan {
                text: trimmed_all.to_string(),
                start_byte,
                end_byte,
            });
        }
    }
    
    let sentence_count_before_merge = all_sentences.len();
    all_sentences = merge_short_sentences(html, all_sentences);

    log::debug!(
        "Extracted {} sentences from HTML body ({} after short-fragment merge)",
        sentence_count_before_merge,
        all_sentences.len()
    );

    Ok(all_sentences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_short_into_previous_still_works_in_one_text_run() {
        let html = "<html><body><p>This is the first valid sentence. Ok. This is another valid sentence.</p></body></html>";
        let s = extract_all_sentences(html).unwrap();
        assert!(
            !s.iter().any(|x| x.text.trim().eq_ignore_ascii_case("ok.")),
            "Ok. should merge into the previous sentence when only whitespace separates them in HTML"
        );
    }

    #[test]
    fn merge_does_not_span_block_markup_so_sentence_ids_match_spans() {
        let html = r#"<html><body><p>First sentence is long enough to pass minimum length.</p><p>Ok.</p></body></html>"#;
        let s = extract_all_sentences(html).unwrap();
        assert!(
            s.iter()
                .any(|x| x.text.trim().eq_ignore_ascii_case("ok.")),
            "Ok. must stay its own sentence when </p>…<p> lies between; merging would break span/highlight alignment"
        );
    }
}

