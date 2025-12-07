//! Tests for utils::text module
//!
//! Tests text processing functions:
//! - count_words
//! - count_words_in_html

use aurorabook_lib::utils::text;

#[test]
fn test_count_words_basic() {
    assert_eq!(text::count_words("Hello world"), 2);
    assert_eq!(text::count_words("One"), 1);
    assert_eq!(text::count_words(""), 0);
}

#[test]
fn test_count_words_multiple_spaces() {
    assert_eq!(text::count_words("  multiple   spaces  "), 2);
    assert_eq!(text::count_words("   "), 0);
}

#[test]
fn test_count_words_newlines() {
    assert_eq!(text::count_words("Line one\nLine two"), 4);
    assert_eq!(text::count_words("Line one\n\nLine two"), 4);
}

#[test]
fn test_count_words_tabs() {
    assert_eq!(text::count_words("Word1\tWord2\tWord3"), 3);
}

#[test]
fn test_count_words_in_html_simple() {
    let html = "<p>Hello world</p>";
    assert_eq!(text::count_words_in_html(html), 2);
}

#[test]
fn test_count_words_in_html_nested() {
    let html = "<p>Hello <strong>world</strong>!</p>";
    assert_eq!(text::count_words_in_html(html), 2);
}

#[test]
fn test_count_words_in_html_multiple_elements() {
    let html = "<div><p>First paragraph</p><p>Second paragraph</p></div>";
    assert_eq!(text::count_words_in_html(html), 4);
}

#[test]
fn test_count_words_in_html_with_attributes() {
    let html = r#"<p class="test">Hello world</p>"#;
    assert_eq!(text::count_words_in_html(html), 2);
}

#[test]
fn test_count_words_in_html_empty() {
    assert_eq!(text::count_words_in_html(""), 0);
    assert_eq!(text::count_words_in_html("<p></p>"), 0);
}

#[test]
fn test_count_words_in_html_complex() {
    let html = r#"
        <html>
            <body>
                <h1>Title</h1>
                <p>This is a paragraph with <em>emphasis</em>.</p>
                <p>Another paragraph here.</p>
            </body>
        </html>
    "#;
    let word_count = text::count_words_in_html(html);
    assert!(word_count > 0);
    // Should count: Title, This, is, a, paragraph, with, emphasis, Another, paragraph, here
    assert_eq!(word_count, 10);
}

#[test]
fn test_count_words_consistency() {
    // Test that count_words and count_words_in_html give same result for plain text
    let text = "Hello world test";
    let html = format!("<p>{}</p>", text);
    
    assert_eq!(text::count_words(text), text::count_words_in_html(&html));
}

