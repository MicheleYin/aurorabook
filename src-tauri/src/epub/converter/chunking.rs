use regex::Regex;
use scraper::{Html, Selector};
use once_cell::sync::Lazy;
use crate::utils::errors::{ AppResult};

// Compile regex once at startup instead of on every call
static SENTENCE_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([^.!?]+[.!?]+)\s*")
        .expect("Failed to compile sentence regex pattern")
});

// Compile CSS selectors once at startup instead of on every call
static SELECTOR_P: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("p").expect("Failed to parse CSS selector 'p'")
});
static SELECTOR_H1: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("h1").expect("Failed to parse CSS selector 'h1'")
});
static SELECTOR_H2: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("h2").expect("Failed to parse CSS selector 'h2'")
});
static SELECTOR_H3: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("h3").expect("Failed to parse CSS selector 'h3'")
});
static SELECTOR_H4: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("h4").expect("Failed to parse CSS selector 'h4'")
});
static SELECTOR_H5: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("h5").expect("Failed to parse CSS selector 'h5'")
});
static SELECTOR_H6: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("h6").expect("Failed to parse CSS selector 'h6'")
});
static SELECTOR_LI: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("li").expect("Failed to parse CSS selector 'li'")
});
static SELECTOR_BLOCKQUOTE: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("blockquote").expect("Failed to parse CSS selector 'blockquote'")
});
static SELECTOR_DIV: Lazy<Selector> = Lazy::new(|| {
    Selector::parse("div").expect("Failed to parse CSS selector 'div'")
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
pub fn extract_text_with_spans(html: &str) -> AppResult<(String, String, Vec<(String, usize, usize)>)> {
    let document = Html::parse_document(html);
    let mut full_text = String::new();
    let mut span_mappings: Vec<(String, usize, usize)> = Vec::new();
    let mut span_index = 0;
    let mut current_word_index = 0;
    
    // Use pre-compiled selectors
    let selectors = vec![
        &*SELECTOR_P,
        &*SELECTOR_H1,
        &*SELECTOR_H2,
        &*SELECTOR_H3,
        &*SELECTOR_H4,
        &*SELECTOR_H5,
        &*SELECTOR_H6,
        &*SELECTOR_LI,
        &*SELECTOR_BLOCKQUOTE,
        &*SELECTOR_DIV,
    ];
    
    let sentence_pattern = &*SENTENCE_PATTERN;
    
    // Store replacements with unique markers: (marker, new_content, old_outer_html, inner_text)
    let mut replacements: Vec<(String, String, String, String)> = Vec::new();
    let mut marker_counter = 0;
    
    // Process each element type
    for selector in &selectors {
        for element in document.select(selector) {
            let text = element.text().collect::<String>().trim().to_string();
            if text.is_empty() {
                continue;
            }
            
            // Split into sentences
            let sentences: Vec<&str> = sentence_pattern
                .find_iter(&text)
                .map(|m| m.as_str().trim())
                .filter(|s| !s.is_empty())
                .collect();
            
            let sentences = if sentences.is_empty() {
                vec![text.as_str()]
            } else {
                sentences
            };
            
            // Build new content with spans and track word indices
            let mut new_content = String::new();
            for (idx, sentence) in sentences.iter().enumerate() {
                // Format span ID: f000001, f000002, etc.
                let span_id = format!("f{:06}", span_index + 1);
                
                // Count words in this sentence
                let word_count = sentence.split_whitespace().filter(|s| !s.is_empty()).count();
                let start_word = current_word_index;
                let end_word = current_word_index + word_count;
                
                // Add to full text
                if !full_text.is_empty() {
                    full_text.push(' ');
                }
                full_text.push_str(sentence);
                current_word_index = end_word;
                
                // Track span mapping
                span_mappings.push((span_id.clone(), start_word, end_word));
                
                // Escape XML special characters
                let escaped_sentence = sentence
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('"', "&quot;")
                    .replace('\'', "&apos;");
                new_content.push_str(&format!(r#"<span id="{}">{}</span>"#, span_id, escaped_sentence));
                if idx < sentences.len() - 1 {
                    new_content.push(' ');
                }
                span_index += 1;
            }
            
            // Get the element's outer HTML and inner text for matching
            let element_outer = element.html();
            let element_inner_text = text.clone(); // We already have the text
            let marker = format!("__SPAN_MARKER_{}__", marker_counter);
            marker_counter += 1;
            
            // Store both outer HTML and inner text for more robust matching
            replacements.push((marker, new_content, element_outer, element_inner_text));
        }
    }
    
    // Replace elements using markers
    let mut updated_html = html.to_string();
    
    // Helper function to normalize HTML for matching (handles self-closing tags, whitespace)
    fn normalize_html_for_matching(html: &str) -> String {
        // Normalize self-closing tags: <tag/> -> <tag></tag>
        let mut normalized = html.to_string();
        // Match self-closing tags like <a id="page-2"/>
        normalized = Regex::new(r#"<(\w+)([^>]*?)\s*/>"#)
            .unwrap()
            .replace_all(&normalized, r#"<$1$2></$1>"#)
            .to_string();
        // Normalize whitespace in tags
        normalized = Regex::new(r#"\s+"#)
            .unwrap()
            .replace_all(&normalized, " ")
            .to_string();
        normalized.trim().to_string()
    }
    
    // First pass: replace each element with a unique marker
    // Try exact match first, then try normalized whitespace match, then try regex-based matching
    let mut successful_replacements = 0;
    for (marker, _, old_outer, inner_text) in &replacements {
        let mut found = false;
        
        // Try 1: Exact match
        if let Some(pos) = updated_html.find(old_outer) {
            updated_html.replace_range(pos..pos + old_outer.len(), marker);
            successful_replacements += 1;
            found = true;
        } else {
            // Try 1b: Normalized match (handles self-closing tags and whitespace differences)
            let normalized_old = normalize_html_for_matching(old_outer);
            let normalized_html = normalize_html_for_matching(&updated_html);
            if normalized_html.find(&normalized_old).is_some() {
                // Find the corresponding position in the original HTML
                // This is approximate but should work for most cases
                if let Some(actual_pos) = updated_html.find(&old_outer[..old_outer.len().min(50)]) {
                    // Try to find the full element from this position
                    if old_outer.find('>').is_some() {
                        let tag_name_start = old_outer.find(|c: char| c.is_alphabetic()).unwrap_or(0);
                        let tag_name_end = old_outer[tag_name_start..].find(|c: char| !c.is_alphanumeric() && c != '-').unwrap_or(old_outer.len() - tag_name_start);
                        let tag_name = &old_outer[tag_name_start..tag_name_start + tag_name_end];
                        
                        // Find the opening tag
                        let open_pattern = format!(r#"<{}[^>]*>"#, tag_name);
                        if let Ok(re) = Regex::new(&open_pattern) {
                            if let Some(m) = re.find_at(&updated_html, actual_pos) {
                                let start = m.start();
                                // Find the closing tag
                                if let Some(close_pos) = updated_html[start..].find(&format!("</{}>", tag_name)) {
                                    let end = start + close_pos + format!("</{}>", tag_name).len();
                                    // Verify it contains our text
                                    if updated_html[start..end].contains(inner_text.split_whitespace().next().unwrap_or("")) {
                                        updated_html.replace_range(start..end, marker);
                                        successful_replacements += 1;
                                        found = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if !found {
            // Try 2: Find by matching opening tag and inner text using regex
            if let Some(open_tag_end) = old_outer.find('>') {
                let open_tag = &old_outer[..open_tag_end + 1];
                // Extract tag name from opening tag
                if let Some(tag_name_match) = open_tag.find(|c: char| c.is_alphabetic()) {
                    let tag_end = open_tag[tag_name_match..].find(|c: char| !c.is_alphanumeric() && c != '-').unwrap_or(open_tag.len() - tag_name_match);
                    let tag_name = &open_tag[tag_name_match..tag_name_match + tag_end];
                    
                    // Try multiple strategies to find the element
                    // Strategy 2a: Use a unique text snippet from the beginning of the paragraph
                    let text_snippet = inner_text.split_whitespace().take(5).collect::<Vec<_>>().join(" ");
                    if !text_snippet.is_empty() {
                        let escaped_snippet = regex::escape(&text_snippet);
                        // Match: <tag...>...text_snippet... (more flexible, allows nested elements)
                        let pattern = format!(r#"<{}[^>]*>[\s\S]*?{}"#, tag_name, escaped_snippet);
                        if let Ok(re) = Regex::new(&pattern) {
                            // Find all matches and try to find the one that matches the full element
                            for m in re.find_iter(&updated_html) {
                                // Try to find the closing tag from this position
                                let start = m.start();
                                let after_open = m.end();
                                // Look for the closing tag, but be flexible about nested elements
                                if let Some(close_pos) = updated_html[after_open..].find(&format!("</{}>", tag_name)) {
                                    let end = after_open + close_pos + format!("</{}>", tag_name).len();
                                    // Verify this contains our text
                                    let candidate = &updated_html[start..end];
                                    if candidate.contains(&text_snippet) {
                                        updated_html.replace_range(start..end, marker);
                                        successful_replacements += 1;
                                        found = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    
                    // Strategy 2b: If still not found, try a more flexible pattern with just tag and a shorter text snippet
                    if !found {
                        let short_snippet = inner_text.split_whitespace().take(3).collect::<Vec<_>>().join(" ");
                        if !short_snippet.is_empty() {
                            let escaped_short = regex::escape(&short_snippet);
                            let pattern = format!(r#"<{}[^>]*>[\s\S]{{0,500}}?{}[\s\S]{{0,500}}?</{}>"#, tag_name, escaped_short, tag_name);
                            if let Ok(re) = Regex::new(&pattern) {
                                if let Some(m) = re.find(&updated_html) {
                                    updated_html.replace_range(m.start()..m.end(), marker);
                                    successful_replacements += 1;
                                    found = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if !found {
            log::warn!(
                "Failed to find element in HTML for replacement. Text preview: {}...",
                inner_text.chars().take(50).collect::<String>()
            );
        }
    }
    
    log::debug!(
        "extract_text_with_spans: Replacement pass 1: {} successful out of {} total replacements",
        successful_replacements,
        replacements.len()
    );
    
    // Second pass: replace markers with new content
    let mut successful_marker_replacements = 0;
    for (marker, new_inner, old_outer, _) in &replacements {
        if updated_html.contains(marker) {
            if let Some(open_tag_end) = old_outer.find('>') {
                let open_tag = &old_outer[..open_tag_end + 1];
                if let Some(close_tag_start) = old_outer.rfind("</") {
                    let close_tag = &old_outer[close_tag_start..];
                    let new_pattern = format!("{}{}{}", open_tag, new_inner, close_tag);
                    updated_html = updated_html.replace(marker, &new_pattern);
                    successful_marker_replacements += 1;
                }
            }
        } else {
            log::warn!(
                "Marker not found in HTML (element was not replaced in first pass). Marker: {}",
                marker
            );
        }
    }
    
    log::debug!(
        "extract_text_with_spans: Replacement pass 2: {} successful out of {} total replacements",
        successful_marker_replacements,
        replacements.len()
    );
    
    if successful_replacements != replacements.len() || successful_marker_replacements != replacements.len() {
        log::warn!(
            "Some elements were not successfully replaced with spans. {} replacements attempted, {} successful in pass 1, {} successful in pass 2",
            replacements.len(),
            successful_replacements,
            successful_marker_replacements
        );
    }
    
    Ok((full_text, updated_html, span_mappings))
}

/// Extract all sentences from chapter content for round-robin TTS processing.
///
/// This function extracts all text from the `<body>` element only (skipping `<head>` and `<title>`),
/// then splits it into sentences. This is similar to BeautifulSoup's get_text() in Python.
///
/// # Arguments
/// * `html` - The HTML content to process
///
/// # Returns
/// A vector of sentences in document order
pub fn extract_all_sentences(html: &str) -> AppResult<Vec<String>> {
    let document = Html::parse_document(html);
    let sentence_pattern = &*SENTENCE_PATTERN;
    
    // Extract text only from the body element, skipping head and title
    static SELECTOR_BODY: Lazy<Selector> = Lazy::new(|| {
        Selector::parse("body").expect("Failed to parse CSS selector 'body'")
    });
    
    let all_text = if let Some(body) = document.select(&*SELECTOR_BODY).next() {
        body.text().collect::<String>()
    } else {
        // Fallback: if no body element found, use root element
        // (shouldn't happen with valid HTML, but handle gracefully)
        document.root_element().text().collect::<String>()
    };
    
    // Split into sentences
    let sentences: Vec<&str> = sentence_pattern
        .find_iter(&all_text)
        .map(|m| m.as_str().trim())
        .filter(|s| !s.is_empty())
        .collect();
    
    let all_sentences: Vec<String> = if sentences.is_empty() {
        // If no sentences found, treat the whole text as one sentence
        vec![all_text.trim().to_string()]
    } else {
        sentences.into_iter().map(|s| s.to_string()).collect()
    };
    
    log::debug!("Extracted {} sentences from HTML body", all_sentences.len());
    
    Ok(all_sentences)
}


