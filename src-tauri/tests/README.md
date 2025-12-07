# Test Suite Documentation

This directory contains a comprehensive test suite organized to match the source code structure in `src/`.

## Test Organization

Tests are organized by module, mirroring the source code structure:

```
tests/
├── mod.rs                    # Main test module
├── helpers.rs                 # Shared test helpers
├── book_service/              # Tests for book_service module
│   ├── mod.rs
│   ├── storage.rs            # SQLite database operations
│   ├── models.rs             # Data structures
│   ├── filters.rs            # Filtering and search
│   └── commands.rs           # Tauri command functions
├── epub/                     # Tests for epub module
│   ├── mod.rs
│   ├── parser/               # EPUB parser tests
│   │   ├── mod.rs
│   │   ├── opf.rs           # OPF file operations
│   │   ├── metadata.rs       # Metadata extraction
│   │   ├── navigation.rs     # Navigation parsing
│   │   ├── cover.rs          # Cover image operations
│   │   ├── audio.rs          # Audio track extraction
│   │   ├── chapters.rs       # Chapter extraction
│   │   ├── utils.rs          # Parser utilities
│   │   └── types.rs          # Parser data structures
│   ├── converter/            # EPUB converter tests
│   ├── book_update.rs        # Book update functionality
│   ├── cancellation.rs       # Cancellation handling
│   └── conversion_command.rs # Conversion commands
├── utils/                     # Tests for utils module
│   ├── mod.rs
│   ├── text.rs              # Text processing
│   ├── errors.rs            # Error handling
│   ├── path_resolver.rs     # Path resolution
│   ├── path_validation.rs   # Path validation
│   ├── audio.rs             # Audio utilities
│   └── constants.rs         # Constants
├── tts/                      # Tests for TTS module
│   ├── mod.rs
│   └── engine.rs            # TTS engine
├── tts_commands.rs          # TTS command functions
├── resources.rs             # Resource management
└── integration.rs           # Integration tests
```

## Running Tests

### Run all tests
```bash
cargo test
```

### Run tests for a specific module
```bash
cargo test book_service
cargo test epub::parser
cargo test utils
```

### Run a specific test
```bash
cargo test test_count_words
cargo test test_add_book
```

### Run tests with output
```bash
cargo test -- --nocapture
```

## Test Coverage

### book_service Module
- ✅ SQLite storage operations (CRUD)
- ✅ Book models and serialization
- ✅ Filtering and search functionality
- ✅ Book merging and updates
- ✅ EPUB cache operations

### epub::parser Module
- ✅ OPF file finding and parsing
- ✅ Metadata extraction
- ✅ Navigation (NCX) parsing
- ✅ Cover image operations
- ✅ Audio track extraction
- ✅ Chapter extraction
- ✅ Utility functions

### epub::converter Module
- ✅ Conversion logic (with test EPUB files)
- ✅ Chunking and processing (sentence extraction, HTML span wrapping)
- ✅ EPUB building (full conversion test)
- ✅ SMIL generation (time formatting, file generation)
- ✅ Progress tracking (parallelism, callbacks, serialization)

### utils Module
- ✅ Text processing (word counting)
- ✅ Error handling
- ✅ Path validation
- ✅ Audio utilities
- ✅ Constants

### tts Module
- ✅ Engine type selection
- ✅ Engine pool (with model files from resources/)
- ✅ Audio generation (with model files from resources/)
- ✅ PCM audio generation
- ✅ Multiple instances
- ✅ Different voices

### tts_commands Module
- ✅ Engine initialization
- ✅ PCM to MP3 conversion
- ✅ TTS generation (with model files from resources/)
- ✅ Batch TTS generation (with model files from resources/)

### resources Module
- ✅ Resource file operations
- ✅ Directory copying

## Test Requirements

Some tests require:
- **Model files**: TTS tests need ONNX model and voices files
- **Test EPUB files**: EPUB parser/converter tests need sample EPUB files
- **Database**: Storage tests need SQLite database setup

## Writing New Tests

When adding new functionality, add corresponding tests:

1. **Unit tests**: Test individual functions in isolation
2. **Integration tests**: Test multiple components working together
3. **Edge cases**: Test error conditions, empty inputs, boundary values

### Example Test Structure

```rust
#[test]
fn test_function_name() {
    // Arrange
    let input = create_test_input();
    
    // Act
    let result = function_under_test(input);
    
    // Assert
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), expected_value);
}
```

## Test Helpers

The `helpers.rs` module provides:
- Model file discovery
- Test EPUB file creation
- Database setup utilities
- Mock Tauri app handles

## Continuous Integration

Tests should pass in CI/CD pipelines. Ensure:
- All tests are deterministic
- No hardcoded paths (use temp directories)
- Tests clean up after themselves
- Tests don't depend on external services

## Notes

- Some tests are marked with `#[ignore]` if they require external resources
- Tests that require model files will gracefully handle missing files
- Integration tests may be slower and are kept separate

