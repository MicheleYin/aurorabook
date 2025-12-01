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

/// Chunks HTML content into sentences and adds span tags for text-audio synchronization.
///
/// This function processes HTML content to:
/// 1. Extract text from semantic elements (paragraphs, headings, list items, etc.)
/// 2. Split text into sentences using punctuation patterns
/// 3. Wrap each sentence in a `<span>` tag with a unique ID
/// 4. Return both the chunked text (for TTS) and updated HTML (for EPUB)
///
/// The chunking algorithm:
/// - Processes elements in order: paragraphs, headings (h1-h6), list items, blockquotes, divs
/// - Uses regex to split text by sentence-ending punctuation (`.`, `!`, `?`)
/// - Assigns unique IDs to each chunk (format: `f000001`, `f000002`, etc.)
/// - Escapes XML special characters in the text
/// - Preserves the original HTML structure while adding span tags
///
/// # Arguments
/// * `html` - The HTML content to chunk (typically a chapter from an EPUB)
///
/// # Returns
/// A tuple containing:
/// * `Vec<(String, String)>` - List of (chunk_id, text) pairs for TTS generation
/// * `String` - Updated HTML with span tags for synchronization
///
/// # Errors
/// Returns an error if CSS selector parsing fails or regex compilation fails.
///
/// # Example
/// ```rust
/// let html = r#"<p>Hello world. This is a test!</p>"#;
/// let (chunks, updated_html) = chunk_text(html)?;
/// // chunks: [("f000001", "Hello world."), ("f000002", "This is a test!")]
/// // updated_html: r#"<p><span id="f000001">Hello world.</span> <span id="f000002">This is a test!</span></p>"#
/// ```
pub fn chunk_text(html: &str) -> AppResult<(Vec<(String, String)>, String)> {
    let document = Html::parse_document(html);
    let mut chunks: Vec<(String, String)> = Vec::new();
    let mut chunk_index = 0;
    
    // Use pre-compiled selectors (compiled once at startup)
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
    
    // Use pre-compiled regex (compiled once at startup)
    let sentence_pattern = &*SENTENCE_PATTERN;
    
    // Store replacements with unique markers to avoid conflicts
    let mut replacements: Vec<(String, String, String)> = Vec::new();
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
            
            // Build new content with spans
            let mut new_content = String::new();
            for (idx, sentence) in sentences.iter().enumerate() {
                // Format chunk ID: f000001, f000002, etc.
                let chunk_id = format!("f{:06}", chunk_index + 1);
                // Escape XML special characters
                let escaped_sentence = sentence
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('"', "&quot;")
                    .replace('\'', "&apos;");
                new_content.push_str(&format!(r#"<span id="{}">{}</span>"#, chunk_id, escaped_sentence));
                if idx < sentences.len() - 1 {
                    new_content.push(' ');
                }
                chunks.push((chunk_id.clone(), sentence.to_string()));
                chunk_index += 1;
            }
            
            // Get the element's outer HTML
            let element_outer = element.html();
            let marker = format!("__CHUNK_MARKER_{}__", marker_counter);
            marker_counter += 1;
            
            replacements.push((marker, new_content, element_outer));
        }
    }
    
    // Replace elements using markers
    let mut updated_html = html.to_string();
    
    // First pass: replace each element with a unique marker
    for (marker, _, old_outer) in &replacements {
        if let Some(pos) = updated_html.find(old_outer) {
            updated_html.replace_range(pos..pos + old_outer.len(), marker);
        }
    }
    
    // Second pass: replace markers with new content
    for (marker, new_inner, old_outer) in &replacements {
        if let Some(open_tag_end) = old_outer.find('>') {
            let open_tag = &old_outer[..open_tag_end + 1];
            if let Some(close_tag_start) = old_outer.rfind("</") {
                let close_tag = &old_outer[close_tag_start..];
                let new_pattern = format!("{}{}{}", open_tag, new_inner, close_tag);
                updated_html = updated_html.replace(marker, &new_pattern);
            }
        }
    }
    
    Ok((chunks, updated_html))
}

