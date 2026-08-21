//! IPC wire-format contract tests.
//!
//! Fixtures under `tests/fixtures/ipc/` are the shared source of truth between
//! Rust serde models and the frontend. If deserialization fails here, the
//! frontend will also break at runtime.

use std::fs;
use std::path::PathBuf;

use aurorabook_lib::book_service::models::{Book, Chapter};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/ipc")
}

fn load_fixture(name: &str) -> String {
    let path = fixtures_dir().join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!("Failed to read fixture {}: {}", path.display(), e)
    })
}

#[test]
fn book_wire_fixture_deserializes() {
    let json = load_fixture("book.wire.json");
    let book: Book = serde_json::from_str(&json).expect("Book wire fixture");

    assert_eq!(book.id, "book-e2e-001");
    assert_eq!(book.chapters.len(), 2);
    assert_eq!(book.chapters[0].order, 0);
    assert_eq!(book.chapters[1].order, 1);
    assert_eq!(book.audio_tracks.len(), 1);
    assert_eq!(book.audio_tracks[0].href, "Audio/chap1.mp3");
    assert!(book.progress.is_some());
    assert!(book.audio_state.is_some());
}

#[test]
fn chapter_accepts_legacy_order_alias() {
    let json = r#"{
        "id": "c1",
        "title": "Legacy",
        "order": 4,
        "href": "Text/legacy.xhtml"
    }"#;
    let chapter: Chapter = serde_json::from_str(json).expect("legacy order");
    assert_eq!(chapter.order, 4);

    let serialized = serde_json::to_value(&chapter).unwrap();
    assert_eq!(serialized["chapterOrder"], 4);
    assert!(serialized.get("order").is_none());
}

#[test]
fn chapter_content_fixture_deserializes() {
    let json = load_fixture("chapter-content.wire.json");
    let chapter: Chapter = serde_json::from_str(&json).expect("chapter content");
    assert_eq!(chapter.order, 0);
    assert!(chapter
        .content_html
        .as_ref()
        .is_some_and(|html| html.contains("engines hummed")));
}
