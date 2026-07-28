# Ignored Tests Summary

## Overview
There are **10 tests** currently marked with `#[ignore]` that require Tauri `AppHandle` context. These tests are excluded from the default test run but can be executed with `cargo test -- --ignored`.

## Why These Tests Are Ignored

These tests require a Tauri `AppHandle` to:
- Access app data directories (`app.path().app_data_dir()`)
- Access resource directories (`app.path().resource_dir()`)
- Use Tauri's plugin store for caching EPUB data
- Initialize SQLite database connections

## Ignored Tests by Module

### 1. `book_service::storage` (3 tests)
- `test_database_initialization` - Tests SQLite database setup
- `test_add_book` - Tests adding books to the database
- `test_epub_cache_operations` - Tests EPUB buffer caching

**Required:** `AppHandle` for database path resolution and store access

### 2. `resources` (3 tests)
- `test_read_resource_file` - Tests reading files from resource directory
- `test_copy_resource_file` - Tests copying resource files
- `test_copy_directory` - Tests copying resource directories

**Required:** `AppHandle` for resource directory path resolution

### 3. `tts_commands` (3 tests)
- `test_init_kokoros_engine_valid_path` - Tests engine initialization with valid paths
- `test_init_kokoros_engine_empty_path` - Tests engine initialization with bundle resources
- `test_init_kokoros_engine_invalid_extension` - Tests validation of file extensions

**Required:** `AppHandle` for resource path resolution (when using bundle resources)

**Note:** The underlying TTS functionality is already tested in `tts::engine` tests, which don't require `AppHandle`.

### 4. `epub::conversion_command` (1 test)
- `test_convert_epub_to_audiobook_command` - Tests the full conversion command

**Required:** `AppHandle` and TTS model files

## Current Status

All ignored tests pass when run with `--ignored` flag, but they are empty stubs that need implementation.

## How to Enable These Tests

### Option 1: Use Tauri Test Utilities (Recommended)
Tauri 2.0 may provide test utilities. To enable:

1. Add `"test"` feature to Tauri in `Cargo.toml`:
   ```toml
   tauri = { version = "2", features = ["test"] }
   ```

2. Use `tauri::test::mock_app()` to create a mock app handle:
   ```rust
   let app = tauri::test::mock_app();
   let app_handle = app.app_handle();
   ```

3. Update tests to use the mock app handle

### Option 2: Integration Tests
Create integration tests that run with a real Tauri application context. These would be in `tests/` directory as separate test binaries.

### Option 3: Dependency Injection
Refactor functions to accept path resolvers instead of `AppHandle` directly, making them easier to test.

## Continuous Integration

PR CI runs the **fast** suite only (`cargo test --lib` with `cargo-llvm-cov`).
Ignored AppHandle tests are not executed there. Full `--ignored` runs remain a
local / optional concern.

## Testing Strategy

The current approach is:
- **Unit tests** (not ignored): Test core logic without Tauri dependencies
- **Integration tests** (ignored): Test Tauri command wrappers with real app context

For example:
- `tts::engine` tests verify TTS functionality without `AppHandle`
- `tts_commands` tests (ignored) would test the Tauri command wrapper

## Running Ignored Tests

```bash
# Run only ignored tests
cargo test --test mod -- --ignored

# Run all tests including ignored
cargo test --test mod -- --include-ignored
```

## Next Steps

1. Investigate Tauri 2.0 test utilities and mock app support
2. Implement tests using mock app handles if available
3. Consider refactoring to reduce `AppHandle` dependencies for better testability
4. Create integration test suite for full end-to-end testing

