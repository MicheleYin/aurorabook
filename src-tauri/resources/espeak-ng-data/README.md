# eSpeak-ng data (for misaki-rs / Kokoro G2P)

The `espeak-rs` crate (used by misaki-rs) loads **voice and phoneme tables from disk** at runtime. It expects a directory named `espeak-ng-data` next to the path given by `PIPER_ESPEAKNG_DATA_DIRECTORY` (see `espeak-rs` on crates.io).

This folder is **not** committed to git (it is large). It is **filled automatically** when you run `cargo build` / `tauri build`: `build.rs` copies the tree produced by the `espeak-rs-sys` crate from your Cargo target directory (see `../../.cargo-target` in `.cargo/config.toml`) into `resources/espeak-ng-data/`, and Tauri bundles it into the app for macOS (and other desktop targets).

If the directory only contains this README, run `cargo build -p aurorabook` from `src-tauri` so `espeak-rs-sys` completes, then build again if needed so `build.rs` can find `phondata` and sync.

At runtime, `lib.rs` sets `PIPER_ESPEAKNG_DATA_DIRECTORY` to the directory that **contains** `espeak-ng-data` (typically `…/Resources/resources/` in a bundled macOS app, matching where Tauri places `bundle.resources`). The `[build] target-dir` setting is compile-time only and does not appear in the shipped app.

**License:** eSpeak-ng is GPL-3.0. Ensure your distribution complies with that license and with App Store rules if you ship there.
