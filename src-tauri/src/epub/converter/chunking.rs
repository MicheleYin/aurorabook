use crate::utils::errors::AppResult;
use htmlparser::{Token, Tokenizer};

/// Sentence with its position in the original HTML
#[derive(Debug, Clone)]
pub struct SentenceWithSpan {
    pub text: String,
    pub start_byte: usize,
    pub end_byte: usize,
}

// Minimum sizes used to decide whether to merge "short fragment" sentences.
// Adjusting these values changes sentence segmentation / highlighting behavior.
const MIN_SENTENCE_WORDS: usize = 20;
const MIN_SENTENCE_ALNUM_CHARS: usize = 40;

fn is_too_short_sentence(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }

    let word_count = crate::utils::text::count_words(trimmed);
    let alnum_char_count = trimmed.chars().filter(|c| c.is_alphanumeric()).count();

    word_count < MIN_SENTENCE_WORDS || alnum_char_count < MIN_SENTENCE_ALNUM_CHARS
}

fn normalize_tag_name(tag: &str) -> &str {
    tag.rsplit([':', '}'])
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or(tag)
}

fn is_skip_tag(tag: &str) -> bool {
    matches!(
        normalize_tag_name(tag).to_ascii_lowercase().as_str(),
        "script" | "style" | "svg" | "math" | "noscript" | "template" | "head"
    )
}

fn is_body_tag(tag: &str) -> bool {
    normalize_tag_name(tag).eq_ignore_ascii_case("body")
}

const PARSE_WRAP_PREFIX: &str = "<html><body>";
const PARSE_WRAP_SUFFIX: &str = "</body></html>";

fn html_has_body_element(html: &str) -> bool {
    Tokenizer::from(html).any(|token| {
        matches!(
            token,
            Ok(Token::ElementStart { local, .. }) if is_body_tag(local.as_str())
        )
    })
}

fn looks_like_full_html_document(html: &str) -> bool {
    let trimmed = html.trim_start_matches('\u{feff}').trim_start();
    let prefix: String = trimmed.chars().take(32).collect();
    let lower = prefix.to_ascii_lowercase();
    lower.starts_with("<?xml") || lower.starts_with("<!doctype") || lower.starts_with("<html")
}

/// Wrap multi-root fragments so the tokenizer keeps every paragraph. Full HTML/XHTML
/// documents are left unchanged — wrapping those nested a second `<html><body>` and
/// the reader then dropped highlight spans when injecting the chapter into a div.
fn should_wrap_for_parse(html: &str) -> bool {
    !html_has_body_element(html) && !looks_like_full_html_document(html)
}

fn wrap_for_parse(html: &str) -> String {
    if should_wrap_for_parse(html) {
        format!("{}{}{}", PARSE_WRAP_PREFIX, html, PARSE_WRAP_SUFFIX)
    } else {
        html.to_string()
    }
}

fn unwrap_parse_wrap(updated: &str, original: &str) -> String {
    if !should_wrap_for_parse(original) {
        return updated.to_string();
    }
    let rest = match updated.strip_prefix(PARSE_WRAP_PREFIX) {
        Some(rest) => rest,
        None => return updated.to_string(),
    };
    if let Some(inner) = rest.strip_suffix(PARSE_WRAP_SUFFIX) {
        return inner.to_string();
    }
    if let Some(idx) = rest.rfind(PARSE_WRAP_SUFFIX) {
        format!("{}{}", &rest[..idx], &rest[idx + PARSE_WRAP_SUFFIX.len()..])
    } else {
        rest.to_string()
    }
}

fn should_capture_text(in_body: bool, has_body: bool, skip_depth: usize) -> bool {
    skip_depth == 0 && (in_body || !has_body)
}

const ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc", "inc", "ltd", "st", "rd", "ave",
    "no", "vol", "fig", "al", "cf", "eg", "ie", "ch", "pg", "pp", "ed", "eds", "rev", "gen", "col",
    "sgt", "capt", "lt", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct",
    "nov", "dec",
];

fn word_before_dot(text: &str, dot_index: usize) -> &str {
    let before = text.get(..dot_index).unwrap_or("");
    before
        .rsplit(|c: char| !c.is_alphabetic())
        .next()
        .unwrap_or("")
}

fn is_decimal_dot(text: &str, dot_index: usize) -> bool {
    let prev = text.get(..dot_index).and_then(|s| s.chars().last());
    let next = text.get(dot_index + 1..).and_then(|s| s.chars().next());
    matches!((prev, next), (Some(p), Some(n)) if p.is_ascii_digit() && n.is_ascii_digit())
}

fn is_abbreviation_dot(text: &str, dot_index: usize) -> bool {
    let word = word_before_dot(text, dot_index);
    if word.is_empty() {
        return false;
    }
    if word.chars().count() == 1 && word.chars().all(|c| c.is_uppercase()) {
        return true;
    }
    ABBREVIATIONS
        .iter()
        .any(|abbr| word.eq_ignore_ascii_case(abbr))
}

fn consume_closing_quotes(text: &str, mut idx: usize) -> usize {
    while let Some(ch) = text.get(idx..).and_then(|s| s.chars().next()) {
        if matches!(ch, '"' | '\'' | '”' | '’' | '»') {
            idx += ch.len_utf8();
        } else {
            break;
        }
    }
    idx
}

/// Split a text block into sentence ranges `[start, end)` that follow reading order.
fn split_prose_sentences(text: &str) -> Vec<(usize, usize)> {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    let mut start = match text.find(|c: char| !c.is_whitespace()) {
        Some(idx) => idx,
        None => return ranges,
    };
    let mut idx = start;

    while idx < text.len() {
        let Some(ch) = text[idx..].chars().next() else {
            break;
        };
        let ch_len = ch.len_utf8();
        let is_ellipsis = ch == '…' || (ch == '.' && text.get(idx..idx + 3) == Some("..."));
        let is_end_punct = ch == '.' || ch == '!' || ch == '?' || is_ellipsis;

        if is_end_punct {
            let term_end = if ch == '.' && text.get(idx..idx + 3) == Some("...") {
                idx + 3
            } else {
                idx + ch_len
            };
            let should_split = if ch == '.' && !is_ellipsis {
                !is_decimal_dot(text, idx) && !is_abbreviation_dot(text, idx)
            } else {
                true
            };
            if should_split {
                let end = consume_closing_quotes(text, term_end);
                let piece = text[start..end].trim_end();
                if !piece.is_empty() {
                    ranges.push((start, start + piece.len()));
                }
                let next = text[end..]
                    .find(|c: char| !c.is_whitespace())
                    .map(|offset| end + offset);
                match next {
                    Some(next_start) => {
                        start = next_start;
                        idx = next_start;
                    }
                    None => return ranges,
                }
                continue;
            }
        }

        idx += ch_len;
    }

    let remaining = text[start..].trim_end();
    if !remaining.is_empty() {
        ranges.push((start, start + remaining.len()));
    }
    ranges
}

/// Two adjacent sentences may only be merged when their HTML byte ranges are not separated by
/// markup. Otherwise `extract_text_with_spans` closes spans at element boundaries and the merged
/// `SentenceWithSpan` (one `start_byte`/`end_byte` covering both) no longer matches span `id`s in
/// the rebuilt HTML — breaking sentence-id lookup for highlighting.
fn can_merge_adjacent_in_html(
    html: &str,
    left: &SentenceWithSpan,
    right: &SentenceWithSpan,
) -> bool {
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
fn merge_short_sentences(
    html: &str,
    mut sentences: Vec<SentenceWithSpan>,
) -> Vec<SentenceWithSpan> {
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
                previous.text = format!("{} {}", previous.text.trim_end(), short.text.trim_start())
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
pub fn extract_text_with_spans(
    html: &str,
    sentence_spans: Option<&[SentenceWithSpan]>,
) -> AppResult<(String, String, Vec<(String, usize, usize)>)> {
    // Use provided spans if available, otherwise extract them
    let sentences_with_spans = if let Some(spans) = sentence_spans {
        spans.to_vec()
    } else {
        extract_all_sentences(html)?
    };

    if sentences_with_spans.is_empty() {
        return Ok((String::new(), html.to_string(), Vec::new()));
    }

    let original_html = html;
    let document = wrap_for_parse(original_html);
    let html = document.as_str();

    // Extract just the sentence texts for compatibility
    let sentences: Vec<String> = sentences_with_spans
        .iter()
        .map(|s| s.text.clone())
        .collect();

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
    let has_body = html_has_body_element(html);
    let mut in_body = false;
    let mut skip_depth = 0usize;

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
                let element_name = local.as_str();
                let started_skip = is_skip_tag(element_name);
                if started_skip {
                    skip_depth += 1;
                }

                // Only push to stack if not self-closing
                if !is_self_closing {
                    if is_body_tag(element_name) {
                        in_body = true;
                    }
                    element_stack.push(element_name.to_string());
                } else if started_skip {
                    skip_depth = skip_depth.saturating_sub(1);
                }

                // Output the element start tag
                output.push_str(element_str);
                html_pos = span.end();
            }
            Ok(Token::ElementEnd { end, span, .. }) => {
                use htmlparser::ElementEnd;

                output.push_str(&html[html_pos..span.start()]);

                match end {
                    // htmlparser emits Close(prefix, local); the local name is the second field.
                    ElementEnd::Close(_prefix, closing_local) => {
                        let closing_name = closing_local.as_str();
                        if span_is_open {
                            output.push_str("</span>");
                            span_is_open = false;
                        }
                        if is_skip_tag(closing_name) {
                            skip_depth = skip_depth.saturating_sub(1);
                        }
                        if is_body_tag(closing_name) {
                            in_body = false;
                        }
                        if let Some(stack_pos) = element_stack.iter().rposition(|name| {
                            name.eq_ignore_ascii_case(closing_name)
                                || normalize_tag_name(name)
                                    .eq_ignore_ascii_case(normalize_tag_name(closing_name))
                        }) {
                            element_stack.remove(stack_pos);
                        }
                    }
                    ElementEnd::Empty => {
                        if let Some(name) = element_stack.pop() {
                            if is_skip_tag(&name) {
                                skip_depth = skip_depth.saturating_sub(1);
                            }
                            if is_body_tag(&name) {
                                in_body = false;
                            }
                        }
                    }
                    ElementEnd::Open => {}
                }

                output.push_str(&html[span.start()..span.end()]);
                html_pos = span.end();
            }
            Ok(Token::Text { text }) => {
                let text_start = text.start();
                let text_end = text.end();
                let text_content = text.as_str();

                // Output HTML before this text token
                output.push_str(&html[html_pos..text_start]);

                // Only wrap sentences in captured prose (body, or whole document if no body)
                if should_capture_text(in_body, has_body, skip_depth) {
                    // Find all sentences that overlap with this text token, sorted by start position
                    let mut relevant_sentences: Vec<(usize, &SentenceWithSpan)> =
                        sentences_with_spans
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
                                let slice = &text_content
                                    [pos_in_token..sent_start_in_token.min(text_content.len())];
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
                                let slice = &text_content
                                    [pos_in_token..sent_end_in_token.min(text_content.len())];
                                output.push_str(slice);
                                pos_in_token = sent_end_in_token;
                            }

                            // Close sentence if it ends in this token
                            if span_data.end_byte > text_start
                                && span_data.end_byte <= text_end
                                && span_is_open
                            {
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

    // Close leftover spans before copying the remainder so a parse-only
    // `</body></html>` suffix can be stripped cleanly.
    if span_is_open {
        output.push_str("</span>");
    }

    if html_pos < html.len() {
        output.push_str(&html[html_pos..]);
    }

    let updated_html = unwrap_parse_wrap(&output, original_html);

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
    matches!(
        normalize_tag_name(tag).to_ascii_lowercase().as_str(),
        "a" | "b"
            | "i"
            | "em"
            | "strong"
            | "span"
            | "sub"
            | "sup"
            | "u"
            | "code"
            | "mark"
            | "cite"
            | "q"
            | "br"
            | "small"
            | "big"
            | "font"
            | "abbr"
            | "dfn"
            | "time"
            | "ruby"
            | "rb"
            | "rt"
            | "rp"
            | "bdi"
            | "bdo"
            | "wbr"
            | "s"
            | "strike"
            | "del"
            | "ins"
    )
}

pub fn extract_all_sentences(html: &str) -> AppResult<Vec<SentenceWithSpan>> {
    let document = wrap_for_parse(html);
    let html = document.as_str();
    let has_body = html_has_body_element(html);
    let mut text_segments: Vec<TextSegment> = Vec::new();
    let mut in_body = false;
    let mut skip_depth = 0usize;
    let mut last_start_was_skip = false;
    let mut combined_byte_pos = 0;
    let mut current_block_id = 0;

    for token in Tokenizer::from(html) {
        match token {
            Ok(Token::ElementStart { local, .. }) => {
                let tag = local.as_str();
                last_start_was_skip = is_skip_tag(tag);
                if is_body_tag(tag) {
                    in_body = true;
                }
                if last_start_was_skip {
                    skip_depth += 1;
                } else if should_capture_text(in_body, has_body, skip_depth) && !is_inline_tag(tag)
                {
                    current_block_id += 1;
                }
            }
            Ok(Token::ElementEnd { end, .. }) => {
                use htmlparser::ElementEnd;
                match end {
                    ElementEnd::Close(_prefix, local) => {
                        let tag = local.as_str();
                        if is_skip_tag(tag) {
                            skip_depth = skip_depth.saturating_sub(1);
                        }
                        if is_body_tag(tag) {
                            in_body = false;
                        } else if should_capture_text(in_body, has_body, skip_depth)
                            && !is_inline_tag(tag)
                        {
                            current_block_id += 1;
                        }
                        last_start_was_skip = false;
                    }
                    ElementEnd::Empty => {
                        if last_start_was_skip {
                            skip_depth = skip_depth.saturating_sub(1);
                            last_start_was_skip = false;
                        }
                    }
                    ElementEnd::Open => {}
                }
            }
            Ok(Token::Text { text }) => {
                if should_capture_text(in_body, has_body, skip_depth) {
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
        if segments.is_empty() {
            return None;
        }
        if combined_pos <= segments[0].combined_start {
            return Some(segments[0].html_start);
        }
        let last = segments.last()?;
        if combined_pos >= last.combined_end {
            return Some(last.html_end);
        }

        for seg in segments {
            if combined_pos >= seg.combined_start && combined_pos <= seg.combined_end {
                let offset_in_seg = combined_pos - seg.combined_start;
                let html_len = seg.html_end.saturating_sub(seg.html_start);
                return Some(seg.html_start + offset_in_seg.min(html_len));
            }
        }

        segments
            .iter()
            .min_by_key(|seg| {
                if combined_pos < seg.combined_start {
                    seg.combined_start - combined_pos
                } else {
                    combined_pos - seg.combined_end
                }
            })
            .map(|seg| {
                if combined_pos < seg.combined_start {
                    seg.html_start
                } else {
                    seg.html_end
                }
            })
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
            for (range_start, range_end) in split_prose_sentences(trimmed_block) {
                if range_end <= range_start {
                    continue;
                }
                let start_combined = block_segments[0].combined_start + block_offset + range_start;
                let end_combined = start_combined + (range_end - range_start);
                let start_byte = map_to_html(start_combined, block_segments)
                    .unwrap_or(block_segments[0].html_start);
                let end_byte = map_to_html(end_combined, block_segments).unwrap_or(
                    block_segments
                        .last()
                        .map(|segment| segment.html_end)
                        .unwrap_or(html.len()),
                );
                all_sentences.push(SentenceWithSpan {
                    text: trimmed_block[range_start..range_end].to_string(),
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
            let start_byte =
                map_to_html(trim_offset, &text_segments).unwrap_or(text_segments[0].html_start);
            let end_byte = map_to_html(trim_offset + trimmed_all.len(), &text_segments).unwrap_or(
                text_segments
                    .last()
                    .map(|s| s.html_end)
                    .unwrap_or(html.len()),
            );
            all_sentences.push(SentenceWithSpan {
                text: trimmed_all.to_string(),
                start_byte,
                end_byte,
            });
        }
    }

    let sentence_count_before_merge = all_sentences.len();
    all_sentences = merge_short_sentences(html, all_sentences);
    all_sentences.sort_by_key(|sentence| (sentence.start_byte, sentence.end_byte));

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

    #[test]
    fn extracts_fragment_html_without_body_in_document_order() {
        let html = "<p>Alpha paragraph one is long enough to remain a standalone spoken sentence.</p><p>Beta paragraph two is long enough to remain a standalone spoken sentence.</p>";
        let sentences = extract_all_sentences(html).unwrap();
        assert!(
            sentences.len() >= 2,
            "expected two sentences, got {}: {:?}",
            sentences.len(),
            sentences
                .iter()
                .map(|s| s.text.as_str())
                .collect::<Vec<_>>()
        );
        assert!(sentences[0].text.contains("Alpha"));
        assert!(sentences[1].text.contains("Beta"));
        assert!(sentences[0].start_byte < sentences[1].start_byte);
    }

    #[test]
    fn does_not_split_decimals_or_abbreviations() {
        let html = "<html><body><p>Dr. Smith measured 3.14 as the value and then kept talking long enough.</p></body></html>";
        let sentences = extract_all_sentences(html).unwrap();
        assert_eq!(sentences.len(), 1);
        assert!(sentences[0].text.contains("3.14"));
        assert!(sentences[0].text.contains("Dr. Smith"));
    }

    #[test]
    fn skips_script_and_keeps_paragraph_order() {
        let html = r#"<html><body>
            <p>First spoken sentence is long enough to keep.</p>
            <script>ignored.payload();</script>
            <p>Second spoken sentence is long enough to keep.</p>
        </body></html>"#;
        let sentences = extract_all_sentences(html).unwrap();
        let joined = sentences
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(joined.contains("First spoken"));
        assert!(joined.contains("Second spoken"));
        assert!(!joined.contains("ignored.payload"));
        assert!(sentences[0].text.contains("First"));
        assert!(sentences.last().unwrap().text.contains("Second"));
    }

    #[test]
    fn split_prose_keeps_reading_order() {
        let ranges = split_prose_sentences(
            "Hello there everyone listening. Then came the second spoken sentence.",
        );
        assert_eq!(ranges.len(), 2);
        assert!(ranges[0].0 < ranges[1].0);
    }

    fn span_ids_in_html(html: &str) -> Vec<String> {
        let needle = r#"<span id=""#;
        let mut ids = Vec::new();
        let mut search_from = 0;
        while let Some(idx) = html[search_from..].find(needle) {
            let start = search_from + idx + needle.len();
            match html[start..].find('"') {
                Some(end) => {
                    ids.push(html[start..start + end].to_string());
                    search_from = start + end + 1;
                }
                None => break,
            }
        }
        ids
    }

    #[test]
    fn fragment_html_keeps_highlight_spans_without_wrapping_the_chapter() {
        let html = "<p>Alpha paragraph one is long enough to remain a standalone spoken sentence.</p><p>Beta paragraph two is long enough to remain a standalone spoken sentence.</p>";
        let sentences = extract_all_sentences(html).unwrap();
        let (_text, updated, mappings) = extract_text_with_spans(html, Some(&sentences)).unwrap();

        assert!(
            !updated
                .trim_start()
                .to_ascii_lowercase()
                .starts_with("<html"),
            "fragment chapters must not be stored as a nested html/body document: {updated}"
        );
        assert!(updated.contains("<p>"));
        assert!(
            mappings.len() >= 2,
            "expected mappings for both paragraphs, got {mappings:?}"
        );
        let ids = span_ids_in_html(&updated);
        for (span_id, _, _) in &mappings {
            assert!(
                ids.contains(span_id),
                "missing highlight span {span_id} in {updated}"
            );
        }
    }

    #[test]
    fn html_without_body_keeps_document_root_and_highlight_spans() {
        let html = r#"<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter</title></head>
<p>Alpha paragraph one is long enough to remain a standalone spoken sentence.</p>
<p>Beta paragraph two is long enough to remain a standalone spoken sentence.</p>
</html>"#;
        let sentences = extract_all_sentences(html).unwrap();
        assert!(
            sentences.len() >= 2,
            "got {:?}",
            sentences
                .iter()
                .map(|s| s.text.as_str())
                .collect::<Vec<_>>()
        );
        let (_text, updated, mappings) = extract_text_with_spans(html, Some(&sentences)).unwrap();

        let lower = updated.to_ascii_lowercase();
        assert!(lower.contains("<html"));
        assert!(
            !lower.contains("<html><body><html"),
            "must not nest a parse wrap around an existing html document: {updated}"
        );
        let ids = span_ids_in_html(&updated);
        assert!(
            !ids.is_empty(),
            "expected highlight spans, got html: {updated}"
        );
        for (span_id, _, _) in &mappings {
            assert!(
                ids.contains(span_id),
                "missing highlight span {span_id} in {updated}"
            );
        }
    }

    #[test]
    fn xhtml_with_body_keeps_every_sentence_span() {
        let html = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head><body>
<p>First spoken sentence is long enough to keep in this chapter.</p>
<p>Second spoken sentence is long enough to keep in this chapter.</p>
</body></html>"#;
        let (_text, updated, mappings) = extract_text_with_spans(html, None).unwrap();
        assert!(updated.contains("<body"));
        assert!(mappings.len() >= 2);
        let ids = span_ids_in_html(&updated);
        for (span_id, _, _) in &mappings {
            assert!(
                ids.contains(span_id),
                "missing highlight span {span_id} in {updated}"
            );
        }
    }
}
