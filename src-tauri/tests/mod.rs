//! Comprehensive test suite organized by source module
//!
//! This test suite is organized to match the source code structure,
//! ensuring every function in src/ has corresponding unit tests.

// Test modules organized by source structure
pub mod book_service;
pub mod epub;
pub mod utils;
pub mod tts;
pub mod tts_commands;
pub mod resources;
/// Shared JSON fixtures under `tests/fixtures/ipc/` (FE + Rust contract).
pub mod ipc_wire;

// Shared test helpers
pub mod helpers;

// Integration tests (kept for backward compatibility)
pub mod integration;

