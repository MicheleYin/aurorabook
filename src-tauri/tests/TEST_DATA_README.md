# Test Data Directory

This directory contains test EPUB files used by the test suite.

## Test Files

- `e.epub` - Small test EPUB file for basic ingestion and conversion tests
- `language.epub` - Test EPUB file for chapter name extraction and TOC parsing tests

## Usage

Tests use the `find_test_epub()` helper function from `helpers.rs` to locate these files.
The helper searches for files in `tests/test_data/` directory relative to various possible
test execution contexts.

## Adding New Test Files

When adding new test EPUB files:
1. Place them in `src-tauri/tests/test_data/`
2. Use `find_test_epub("filename.epub")` in your tests
3. Update this README with a description of what the file tests

## File Locations

The helper function searches in these locations (in order):
1. `tests/test_data/` (relative to test execution)
2. `src-tauri/tests/test_data/` (from project root)
3. Current directory variations

