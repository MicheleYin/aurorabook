/// Text processing utilities
/// 
/// This module provides utilities for text processing operations,
/// including word counting that matches the TypeScript implementation.

/// Count words in a text string.
///
/// This function counts words by splitting on whitespace and filtering
/// out empty strings. This matches the behavior of the TypeScript
/// `countWords` function which uses the regex `/\S+/g` (matches sequences
/// of non-whitespace characters).
///
/// # Arguments
/// * `text` - The text to count words in
///
/// # Returns
/// The number of words in the text
///
/// # Examples
/// ```
/// use crate::utils::text::count_words;
///
/// assert_eq!(count_words("Hello world"), 2);
/// assert_eq!(count_words("  multiple   spaces  "), 2);
/// assert_eq!(count_words(""), 0);
/// ```
pub fn count_words(text: &str) -> usize {
    text.split_whitespace()
        .filter(|s| !s.is_empty())
        .count()
}

/// Count words in HTML content by extracting text and counting words.
///
/// This function parses HTML, extracts all text content, and counts words
/// using the same logic as `count_words`. This ensures consistency with
/// word counts computed from plain text.
///
/// # Arguments
/// * `html` - HTML content to count words in
///
/// # Returns
/// The number of words in the HTML content
///
/// # Examples
/// ```
/// use crate::utils::text::count_words_in_html;
///
/// let html = "<p>Hello <strong>world</strong>!</p>";
/// assert_eq!(count_words_in_html(html), 2);
/// ```
pub fn count_words_in_html(html: &str) -> usize {
    use scraper::Html;
    
    let document = Html::parse_document(html);
    let text = document.root_element().text().collect::<String>();
    
    count_words(&text)
}

