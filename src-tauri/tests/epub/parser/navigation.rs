//! Tests for epub::parser::navigation module
//!
//! Tests navigation parsing:
//! - parse_ncx_titles

use aurorabook_lib::epub::parser::navigation::*;

#[test]
fn test_parse_ncx_titles() {
    // Test parsing NCX navigation titles
    let ncx_content = r#"
        <?xml version="1.0" encoding="UTF-8"?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
            <navMap>
                <navPoint id="navpoint-1">
                    <navLabel><text>Chapter 1</text></navLabel>
                    <content src="ch1.xhtml"/>
                </navPoint>
                <navPoint id="navpoint-2">
                    <navLabel><text>Chapter 2</text></navLabel>
                    <content src="ch2.xhtml"/>
                </navPoint>
            </navMap>
        </ncx>
    "#;
    
    let titles = parse_ncx_titles(ncx_content).unwrap();
    assert_eq!(titles.len(), 2);
    assert_eq!(titles.get("ch1.xhtml"), Some(&"Chapter 1".to_string()));
    assert_eq!(titles.get("ch2.xhtml"), Some(&"Chapter 2".to_string()));
}

#[test]
fn test_parse_ncx_titles_empty() {
    // Test parsing empty NCX
    let empty_ncx = r#"<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap/></ncx>"#;
    let titles = parse_ncx_titles(empty_ncx).unwrap();
    assert_eq!(titles.len(), 0);
}

#[test]
fn test_parse_ncx_titles_nested() {
    // Test parsing nested navPoints
    let ncx_content = r#"
        <?xml version="1.0" encoding="UTF-8"?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
            <navMap>
                <navPoint id="part1">
                    <navLabel><text>Part 1</text></navLabel>
                    <navPoint id="ch1">
                        <navLabel><text>Chapter 1</text></navLabel>
                        <content src="ch1.xhtml"/>
                    </navPoint>
                </navPoint>
            </navMap>
        </ncx>
    "#;
    
    let titles = parse_ncx_titles(ncx_content).unwrap();
    assert_eq!(titles.len(), 1);
    assert_eq!(titles.get("ch1.xhtml"), Some(&"Chapter 1".to_string()));
}

