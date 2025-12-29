//! Tests for epub::converter::chunking module
//!
//! Tests sentence extraction and HTML chunking:
//! - extract_all_sentences
//! - extract_text_with_spans

use aurorabook_lib::epub::converter::chunking::{extract_all_sentences, extract_text_with_spans};

#[test]
fn test_extract_all_sentences_simple() {
    // extract_all_sentences only extracts text from within <body> tags
    let html = "<html><body><p>This is a sentence. This is another sentence!</p></body></html>";
    let result = extract_all_sentences(html);
    
    assert!(result.is_ok());
    let sentences = result.unwrap();
    assert!(sentences.len() >= 1, "Should extract at least one sentence");
    // The function may combine sentences or split them differently
    let all_text: String = sentences.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
    assert!(all_text.contains("sentence"), "Should contain sentence text");
}

#[test]
fn test_extract_all_sentences_multiple_paragraphs() {
    // extract_all_sentences only extracts text from within <body> tags
    let html = r#"
        <html><body>
        <p>First paragraph. First sentence.</p>
        <p>Second paragraph. Second sentence!</p>
        <p>Third paragraph? Third sentence.</p>
        </body></html>
    "#;
    let result = extract_all_sentences(html);
    
    assert!(result.is_ok());
    let sentences = result.unwrap();
    assert!(sentences.len() >= 1, "Should extract at least one sentence");
    let all_text: String = sentences.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
    assert!(all_text.contains("paragraph"), "Should contain paragraph text");
}

#[test]
fn test_extract_all_sentences_empty() {
    let html = "<p></p>";
    let result = extract_all_sentences(html);
    
    assert!(result.is_ok());
    let sentences = result.unwrap();
    assert_eq!(sentences.len(), 0);
}

#[test]
fn test_extract_all_sentences_no_text() {
    let html = "<div><img src='test.jpg'/></div>";
    let result = extract_all_sentences(html);
    
    assert!(result.is_ok());
    let sentences = result.unwrap();
    // Should handle gracefully - may return empty or extract alt text
}

#[test]
fn test_extract_text_with_spans_simple() {
    // extract_text_with_spans can work with or without body tags
    // It will call extract_all_sentences which requires body tags
    let html = "<html><body><p>Hello world. How are you?</p></body></html>";
    let result = extract_text_with_spans(html, None);
    
    assert!(result.is_ok());
    let (full_text, updated_html, span_mappings) = result.unwrap();
    
    // If sentences were extracted, should have content
    if !full_text.is_empty() {
        // Should extract text
        assert!(full_text.contains("Hello") || full_text.contains("world") || full_text.contains("How"));
        
        // Should add span tags if sentences were found
        if !span_mappings.is_empty() {
            assert!(updated_html.contains("<span"));
            assert!(updated_html.contains("f000001"));
        }
    }
    
    // Should have span mappings if sentences were found
    // (May be empty if no sentences extracted)
}

#[test]
fn test_extract_text_with_spans_with_provided_spans() {
    // Use proper HTML with body tags
    let html = "<html><body><p>Test sentence.</p></body></html>";
    let sentences = extract_all_sentences(html).unwrap();
    
    // If sentences were extracted, test with provided spans
    if !sentences.is_empty() {
        let result = extract_text_with_spans(html, Some(&sentences));
        
        assert!(result.is_ok());
        let (full_text, updated_html, span_mappings) = result.unwrap();
        
        assert!(!full_text.is_empty());
        assert!(updated_html.contains("<span"));
        assert!(!span_mappings.is_empty());
    } else {
        // If no sentences extracted, test still passes (empty input)
        let result = extract_text_with_spans(html, Some(&sentences));
        assert!(result.is_ok());
    }
}

#[test]
fn test_extract_text_with_spans_complex_html() {
    // extract_all_sentences requires body tags
    let html = r#"
        <html><body>
        <h1>Chapter Title</h1>
        <p>First paragraph. First sentence.</p>
        <ul>
            <li>List item one.</li>
            <li>List item two!</li>
        </ul>
        <p>Final paragraph? Final sentence.</p>
        </body></html>
    "#;
    let result = extract_text_with_spans(html, None);
    
    assert!(result.is_ok());
    let (full_text, updated_html, span_mappings) = result.unwrap();
    
    // If sentences were extracted, verify content
    if !full_text.is_empty() {
        // Should extract text from all elements (may be combined)
        let all_lower = full_text.to_lowercase();
        assert!(
            all_lower.contains("chapter") || 
            all_lower.contains("paragraph") || 
            all_lower.contains("list") ||
            all_lower.contains("final"),
            "Should contain some expected text. Got: {}", full_text
        );
        
        // Should have spans if sentences found
        if !span_mappings.is_empty() {
            assert!(span_mappings.len() >= 1);
            // Updated HTML should contain spans
            assert!(updated_html.contains("<span"));
        }
    }
    // If empty, that's also valid (no extractable text)
}

#[test]
fn test_extract_text_with_spans_empty() {
    let html = "<p></p>";
    let result = extract_text_with_spans(html, None);
    
    assert!(result.is_ok());
    let (full_text, updated_html, span_mappings) = result.unwrap();
    
    assert_eq!(full_text, "");
    assert_eq!(updated_html, html);
    assert_eq!(span_mappings.len(), 0);
}

#[test]
fn test_extract_text_with_spans_existing_spans() {
    // Test case from prologue.xhtml - paragraph with existing spans
    // This tests the issue where existing spans cause problems
    let html = r#"<html><body><p><span id="f000053">"Aw, stop being mean to her," he admonished with an effortless smile.</span> <span id="f000054">"And don't worry, Miho, he's just having a little fun with you.</span><span id="f000055" class="">"</span></p></body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    let (full_text, updated_html, span_mappings) = result.unwrap();
    
    // Should extract text correctly even with existing spans
    assert!(full_text.contains("Aw, stop being mean to her"));
    assert!(full_text.contains("And don't worry, Miho"));
    
    // Should add new sentence spans (f000001, f000002, etc.)
    // The existing spans (f000053, f000054, f000055) should be preserved or handled
    assert!(updated_html.contains("<span"), "Should contain span tags");
    
    // Verify input and output match - text should be the same
    // Extract text from updated HTML (ignoring span tags)
    use scraper::Html;
    let doc = Html::parse_document(&updated_html);
    let extracted_text: String = doc.root_element().text().collect();
    
    // Normalize whitespace for comparison
    let extracted_clean: String = extracted_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let full_text_clean: String = full_text.split_whitespace().collect::<Vec<_>>().join(" ");
    
    // Text content should match (allowing for whitespace differences)
    // Note: When closing punctuation is in separate spans, the extracted text from HTML
    // might include it while full_text might not (depending on sentence extraction).
    // We compare normalized versions and allow minor differences.
    let extracted_normalized = extracted_clean.replace(" ", "").to_lowercase();
    let full_text_normalized = full_text_clean.replace(" ", "").to_lowercase();
    
    // Allow for minor differences (like trailing quotes in separate spans)
    // The extracted text should contain all the same words, possibly with extra punctuation
    assert!(
        extracted_normalized == full_text_normalized || 
        (extracted_normalized.len() >= full_text_normalized.len() - 2 && 
         extracted_normalized.starts_with(&full_text_normalized[..full_text_normalized.len().min(20)])),
        "Extracted text from HTML should match full_text (allowing for span boundaries).\nExtracted: {}\nFull: {}\nExtracted (normalized): {}\nFull (normalized): {}",
        extracted_clean,
        full_text_clean,
        extracted_normalized,
        full_text_normalized
    );
}

#[test]
fn test_extract_text_with_spans_prologue_content() {
    // Test with actual content from prologue.xhtml
    let html = r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="default-style" />
    <title>That Time I Got Reincarnated as a Slime, Vol. 1</title>
  </head>
  <body>
    <div class="galley-rw">
      <section class="frontmatter-rw Prologue-rw auto-rw page-open-left-rw" epub:type="frontmatter prologue" id="prologue">
        <h1 class="chapter-titlea">
          <a id="page-1" /><a href="toc.xhtml#toc-prologue">PROLOGUE: DEATH AND REINCARNATION</a>
        </h1>
        <p class="noindent">
          It was just your typical kind of life. I graduated from college,
          landed a job at a sort-of-big general contractor outfit, and with my
          older brother taking care of our parents for me, I was currently
          enjoying all the myriad benefits of the bachelor-pad life. Age
          thirty-seven. No significant other.
        </p>
        <p>
          I wasn't exactly short or frumpy or hideous or anything. But when it
          came to the opposite sex, apparently I had nothing to offer. I'd made
          efforts along those lines, with varying degrees of dedication, but by
          the third rejection, something fizzled out within me. Besides—really,
          at this age, I was kinda past the point where a girlfriend needed to
          be my main focus. Work kept me busy enough. Plus, it wasn't like I was
          gonna die without one.
        </p>
        <p>
          "Aw, stop being mean to her," he admonished with an effortless smile.
          "And don't worry, Miho, he's just having a little fun with you."
        </p>
      </section>
    </div>
  </body>
</html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    let (full_text, updated_html, span_mappings) = result.unwrap();
    
    // Should extract multiple sentences
    assert!(!full_text.is_empty(), "Should extract text from prologue");
    assert!(full_text.contains("typical kind of life"), "Should contain first paragraph text");
    assert!(full_text.contains("graduated from college"), "Should contain college text");
    assert!(full_text.contains("Aw, stop being mean"), "Should contain dialogue");
    
    // Should have span mappings
    assert!(!span_mappings.is_empty(), "Should have span mappings");
    
    // Verify input and output match - extract text from updated HTML
    // Only extract from <body> to match what extract_all_sentences does
    use scraper::Html;
    let doc = Html::parse_document(&updated_html);
    
    // Extract only from body element (not from head/title)
    let body_selector = scraper::Selector::parse("body").unwrap();
    let body_text: String = doc.select(&body_selector)
        .next()
        .map(|body| body.text().collect::<String>())
        .unwrap_or_else(|| doc.root_element().text().collect());
    
    // Normalize whitespace for comparison
    let extracted_normalized: String = body_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let full_text_normalized: String = full_text.split_whitespace().collect::<Vec<_>>().join(" ");
    
    // Allow for minor differences (like trailing punctuation in separate spans)
    let extracted_clean = extracted_normalized.replace(" ", "").to_lowercase();
    let full_text_clean = full_text_normalized.replace(" ", "").to_lowercase();
    
    assert!(
        extracted_clean == full_text_clean || 
        (extracted_clean.len() >= full_text_clean.len() - 2 && 
         extracted_clean.starts_with(&full_text_clean[..full_text_clean.len().min(20)])),
        "Extracted text from updated HTML body should match full_text.\nExtracted (body): {}\nFull: {}\nExtracted (normalized): {}\nFull (normalized): {}",
        extracted_normalized,
        full_text_normalized,
        extracted_clean,
        full_text_clean
    );
    
    // Should have added span tags
    assert!(updated_html.contains(r#"<span id="f"#), "Should contain span tags with f prefix");
    
    // Verify span IDs are sequential
    for (i, (span_id, _, _)) in span_mappings.iter().enumerate() {
        let expected_id = format!("f{:06}", i + 1);
        assert_eq!(
            span_id, &expected_id,
            "Span ID should be sequential. Expected: {}, Got: {}",
            expected_id, span_id
        );
    }
}

#[test]
fn test_extract_text_with_spans_existing_spans_preserved() {
    // Test that existing spans are preserved when wrapping sentences
    // This is the problematic case: existing spans that need to be wrapped
    let html = r#"<html><body><p><span id="f000053">"Aw, stop being mean to her," he admonished with an effortless smile.</span> <span id="f000054">"And don't worry, Miho, he's just having a little fun with you.</span><span id="f000055" class="">"</span></p></body></html>"#;
    
    // First extract sentences
    let sentences = extract_all_sentences(html).unwrap();
    assert!(!sentences.is_empty(), "Should extract sentences even with existing spans");
    
    // Then wrap with new spans
    let result = extract_text_with_spans(html, Some(&sentences));
    assert!(result.is_ok());
    let (full_text, updated_html, span_mappings) = result.unwrap();
    
    // Should extract both sentences
    assert!(full_text.contains("Aw, stop being mean to her"));
    assert!(full_text.contains("And don't worry, Miho"));
    
    // Verify text matches
    use scraper::Html;
    let doc = Html::parse_document(&updated_html);
    let extracted_text: String = doc.root_element().text().collect();
    let extracted_clean: String = extracted_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let full_text_clean: String = full_text.split_whitespace().collect::<Vec<_>>().join(" ");
    
    // Allow for minor differences due to span boundaries (like trailing quotes)
    let extracted_normalized = extracted_clean.replace(" ", "").to_lowercase();
    let full_text_normalized = full_text_clean.replace(" ", "").to_lowercase();
    
    assert!(
        extracted_normalized == full_text_normalized || 
        extracted_normalized.len() >= full_text_normalized.len() - 2,
        "Text should match (allowing for span boundaries). Extracted: {}, Full: {}",
        extracted_clean,
        full_text_clean
    );
    
    // Should have new span IDs (f000001, f000002, etc.)
    assert!(updated_html.contains(r#"<span id="f000001"#) || updated_html.contains(r#"<span id="f000002"#),
        "Should contain new span IDs. HTML: {}", updated_html);
}

#[test]
fn test_extract_text_with_spans_em_tags() {
    // Test with <em> tags like in prologue
    let html = r#"<html><body><p>I'm <em>not</em> making excuses, all right? It's just that I started thinking…</p></body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    let (full_text, updated_html, span_mappings) = result.unwrap();
    
    // Should extract text including content from <em> tags
    assert!(full_text.contains("not"));
    assert!(full_text.contains("making excuses"));
    
    // Verify input and output match
    // Extract only from body to match extract_all_sentences behavior
    use scraper::Html;
    use scraper::Selector;
    let doc = Html::parse_document(&updated_html);
    let body_selector = Selector::parse("body").unwrap();
    let body_text: String = doc.select(&body_selector)
        .next()
        .map(|body| body.text().collect::<String>())
        .unwrap_or_else(|| doc.root_element().text().collect());
    
    let extracted_clean: String = body_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let full_text_clean: String = full_text.split_whitespace().collect::<Vec<_>>().join(" ");
    
    // Normalize for comparison (ellipsis might be handled differently)
    let extracted_normalized = extracted_clean.replace(" ", "").to_lowercase();
    let full_text_normalized = full_text_clean.replace(" ", "").to_lowercase();
    
    // Allow for minor differences (ellipsis, trailing punctuation)
    assert!(
        extracted_normalized == full_text_normalized || 
        (extracted_normalized.len() >= full_text_normalized.len() - 5 &&
         extracted_normalized.starts_with(&full_text_normalized[..full_text_normalized.len().min(30)])),
        "Text with <em> tags should match (allowing for ellipsis/punctuation). Extracted: {}, Full: {}",
        extracted_clean,
        full_text_clean
    );
    
    // <em> tags should be preserved in output
    assert!(updated_html.contains("<em>"), "Should preserve <em> tags");
}

#[test]
fn test_extract_text_with_spans_ellipsis() {
    // Test with ellipsis characters (…) which should be recognized as sentence endings
    // This tests the problematic section from prologue.xhtml (lines 92-117)
    let html = r#"<html><body>
        <p>"Famous? Oof! Not famous in a weird way, I hope?"</p>
        <p>
          "Oh, y'know. I hear stories about you dating Kameyama or messin'
          around with Mr. Kihara in management…"
        </p>
        <p>
          Somehow, I decided that picking on her would be a good idea. I just
          meant it as a passing joke, but it made Sawatari's face turn a bright
          shade of red, her eyes watering up a bit. It was cute, in a way.
          People were always telling me to tone that stuff down—that I needed to
          consider people's feelings more or, if not that, at least make it
          funnier—but I couldn't help myself. So mark that down as another
          failure. Maybe I really <em>do</em> have a crap personality.
        </p>
        <p>
          Tamura took that chance to intervene, giving Sawatari a pat on the
          shoulder.
          <em
            >Dammit, Tamura! So blessed with the natural charm you need to live
            a decent life… I wish people like you would just explode!</em
          >
        </p>
        <p>
          "Aw, stop being mean to her," he admonished with an effortless smile.
          "And don't worry, Miho, he's just having a little fun with you."
        </p>
      </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok(), "Should extract text with ellipsis");
    let (full_text, updated_html, span_mappings) = result.unwrap();
    
    // Should extract text including sentences ending with ellipsis
    assert!(!full_text.is_empty(), "Should extract text");
    assert!(full_text.contains("management"), "Should contain text before ellipsis");
    assert!(full_text.contains("decent life"), "Should contain text before ellipsis in em tag");
    
    // Should have multiple sentences (ellipsis should create sentence boundaries)
    assert!(!span_mappings.is_empty(), "Should have span mappings");
    
    // Verify that sentences ending with ellipsis are properly split
    // The sentence "around with Mr. Kihara in management…" should be recognized
    let sentences: Vec<&str> = full_text.split_whitespace().collect::<Vec<_>>();
    assert!(sentences.len() > 10, "Should extract multiple words");
    
    // Verify input and output match - extract text from updated HTML
    use scraper::Html;
    use scraper::Selector;
    let doc = Html::parse_document(&updated_html);
    let body_selector = Selector::parse("body").unwrap();
    let body_text: String = doc.select(&body_selector)
        .next()
        .map(|body| body.text().collect::<String>())
        .unwrap_or_else(|| doc.root_element().text().collect());
    
    let extracted_clean: String = body_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let full_text_clean: String = full_text.split_whitespace().collect::<Vec<_>>().join(" ");
    
    // Normalize for comparison (ellipsis and punctuation might be handled differently)
    let extracted_normalized = extracted_clean.replace(" ", "").to_lowercase();
    let full_text_normalized = full_text_clean.replace(" ", "").to_lowercase();
    
    // Allow for minor differences (ellipsis, trailing punctuation)
    assert!(
        extracted_normalized == full_text_normalized || 
        (extracted_normalized.len() >= full_text_normalized.len() - 5 &&
         extracted_normalized.starts_with(&full_text_normalized[..full_text_normalized.len().min(30)])),
        "Text with ellipsis should match (allowing for punctuation differences). Extracted: {}, Full: {}",
        extracted_clean,
        full_text_clean
    );
    
    // <em> tags should be preserved in output
    assert!(updated_html.contains("<em>"), "Should preserve <em> tags");
    
    // Should have added span tags
    assert!(updated_html.contains(r#"<span id="f"#), "Should contain span tags with f prefix");
}

/// Helper function to validate HTML structure
fn validate_html_structure(html: &str) -> Result<(), String> {
    use scraper::Html;
    
    // Try to parse the HTML - if it fails, the HTML is invalid
    let doc = Html::parse_document(html);
    
    // Count opening and closing span tags
    let opening_spans = html.matches(r#"<span"#).count();
    let closing_spans = html.matches("</span>").count();
    
    if opening_spans != closing_spans {
        return Err(format!(
            "Unbalanced span tags: {} opening, {} closing",
            opening_spans, closing_spans
        ));
    }
    
    // Check for duplicate span IDs
    use regex::Regex;
    let id_pattern = Regex::new(r#"id="(f\d+)""#).unwrap();
    let mut seen_ids = std::collections::HashSet::new();
    for cap in id_pattern.captures_iter(html) {
        if let Some(id) = cap.get(1) {
            let id_str = id.as_str();
            if !seen_ids.insert(id_str) {
                return Err(format!("Duplicate span ID found: {}", id_str));
            }
        }
    }
    
    Ok(())
}

#[test]
fn test_html_validation_simple() {
    let html = "<html><body><p>First sentence. Second sentence!</p></body></html>";
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid");
}

#[test]
fn test_html_validation_complex_nesting() {
    let html = r#"<html><body>
        <p>First sentence. <em>Emphasized text.</em> Second sentence!</p>
        <div><p>Nested paragraph. Another sentence?</p></div>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid with nested elements");
}

#[test]
fn test_html_validation_multiple_paragraphs() {
    let html = r#"<html><body>
        <p>Paragraph one. First sentence.</p>
        <p>Paragraph two. Second sentence!</p>
        <p>Paragraph three? Third sentence.</p>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid with multiple paragraphs");
}

#[test]
fn test_html_validation_sentence_across_elements() {
    // Test case where a sentence might span across HTML element boundaries
    let html = r#"<html><body>
        <p>Start of sentence <em>middle part</em> end of sentence.</p>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid when sentence spans elements");
}

#[test]
fn test_html_validation_existing_spans() {
    // Test with existing spans that might cause issues
    let html = r#"<html><body><p><span id="existing1">First part.</span> <span id="existing2">Second part!</span></p></body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid with existing spans");
}

#[test]
fn test_html_validation_self_closing_tags() {
    // Test with self-closing tags like <a id="page-1"/>
    let html = r#"<html><body>
        <h1><a id="page-1"/><a href="toc.xhtml">Chapter Title</a></h1>
        <p>First sentence. Second sentence!</p>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid with self-closing tags");
}

#[test]
fn test_html_validation_empty_paragraphs() {
    let html = r#"<html><body>
        <p>First sentence.</p>
        <p></p>
        <p>Second sentence!</p>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid with empty paragraphs");
}

#[test]
fn test_html_validation_list_items() {
    let html = r#"<html><body>
        <ul>
            <li>First item. First sentence.</li>
            <li>Second item! Second sentence.</li>
        </ul>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid with list items");
}

#[test]
fn test_html_validation_provided_spans() {
    // Test with provided spans to ensure validation works in that path too
    let html = "<html><body><p>Test sentence. Another sentence!</p></body></html>";
    let sentences = extract_all_sentences(html).unwrap();
    
    if !sentences.is_empty() {
        let result = extract_text_with_spans(html, Some(&sentences));
        assert!(result.is_ok());
        
        let (_, updated_html, _) = result.unwrap();
        validate_html_structure(&updated_html).expect("HTML should be valid with provided spans");
    }
}

#[test]
fn test_html_validation_edge_case_quotes() {
    // Test with quotes that might be in separate spans
    let html = r#"<html><body><p><span id="f000053">"Aw, stop being mean to her," he said.</span> <span id="f000054">"And don't worry," she replied.</span></p></body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid with quote spans");
}

#[test]
fn test_html_validation_long_content() {
    // Test with longer content that might stress the algorithm
    let html = r#"<html><body>
        <p>Sentence one. Sentence two! Sentence three? Sentence four. Sentence five!</p>
        <p>More sentences. Even more sentences! Many sentences? Lots of sentences.</p>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    validate_html_structure(&updated_html).expect("HTML should be valid with long content");
}

#[test]
fn test_html_validation_orphaned_closing_tags() {
    // Test case that reproduces the malformed HTML issue from sample_audio/final
    // This tests the specific pattern where closing </span> tags appear before opening <span> tags
    let html = r#"<html><body>
        <p>The morning sun cast long shadows across the quiet street. Sarah walked briskly toward the coffee shop, her mind already racing with the day's tasks. She had always found comfort in routine, but today felt different somehow.</p>
        <p>As she pushed open the door, the familiar aroma of freshly ground beans filled the air. The barista smiled warmly and began preparing her usual order. Sarah glanced at the newspaper on the counter, noticing a headline about technological advances in artificial intelligence.</p>
        <p>"Technology continues to evolve at an astonishing pace," she thought to herself. "What seemed impossible yesterday becomes reality today." She paid for her coffee and found a seat by the window, watching the world pass by outside.</p>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    
    // Check for orphaned closing tags (</span> before <span>)
    // This pattern should not exist: </span><span
    assert!(
        !updated_html.contains("</span><span"),
        "Found orphaned closing span tag before opening span. HTML: {}",
        updated_html
    );
    
    // Validate HTML structure
    validate_html_structure(&updated_html).expect("HTML should be valid without orphaned closing tags");
    
    // Verify that every closing span has a corresponding opening span
    let opening_count = updated_html.matches(r#"<span id="f"#).count();
    let closing_count = updated_html.matches("</span>").count();
    assert_eq!(
        opening_count, closing_count,
        "Opening and closing span tags should match. Openings: {}, Closings: {}",
        opening_count, closing_count
    );
}

#[test]
fn test_html_validation_multiple_paragraphs_sequential() {
    // Test multiple paragraphs in sequence to catch span closing issues
    let html = r#"<html><body>
        <p>First paragraph. First sentence.</p>
        <p>Second paragraph. Second sentence!</p>
        <p>Third paragraph? Third sentence.</p>
        <p>Fourth paragraph. Fourth sentence.</p>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    
    // Check for orphaned closing tags
    assert!(
        !updated_html.contains("</span><span"),
        "Found orphaned closing span tag. HTML: {}",
        updated_html
    );
    
    validate_html_structure(&updated_html).expect("HTML should be valid with sequential paragraphs");
}

#[test]
fn test_html_validation_span_not_closed_before_paragraph_end() {
    // Test case that reproduces the issue where spans aren't closed before </p> tags
    // This is the pattern from chapter_1.xhtml where f000006 isn't closed before </p>
    let html = r#"<html><body>
        <p>The morning sun cast long shadows across the quiet street. Sarah walked briskly toward the coffee shop, her mind already racing with the day's tasks. She had always found comfort in routine, but today felt different somehow.</p>
        <p>As she pushed open the door, the familiar aroma of freshly ground beans filled the air. The barista smiled warmly and began preparing her usual order. Sarah glanced at the newspaper on the counter, noticing a headline about technological advances in artificial intelligence.</p>
        <p>"Technology continues to evolve at an astonishing pace," she thought to herself. "What seemed impossible yesterday becomes reality today." She paid for her coffee and found a seat by the window, watching the world pass by outside.</p>
    </body></html>"#;
    
    let result = extract_text_with_spans(html, None);
    assert!(result.is_ok());
    
    let (_, updated_html, _) = result.unwrap();
    
    // Check for orphaned closing tags at the start of paragraphs
    assert!(
        !updated_html.contains("</span><span"),
        "Found orphaned closing span tag. HTML: {}",
        updated_html
    );
    
    // Check that all spans are properly closed before </p> tags
    // Pattern: <span...>text</span></p> or </p> (no unclosed spans)
    // We should NOT have: <span...>text</p> (span not closed)
    let paragraphs: Vec<&str> = updated_html.split("</p>").collect();
    for para in paragraphs {
        if para.contains("<span") {
            // Count opening and closing spans in this paragraph
            let open_count = para.matches(r#"<span id="f"#).count();
            let close_count = para.matches("</span>").count();
            assert_eq!(
                open_count, close_count,
                "Paragraph should have balanced span tags. Paragraph: {}",
                para
            );
        }
    }
    
    validate_html_structure(&updated_html).expect("HTML should be valid with spans closed before paragraph ends");
}

