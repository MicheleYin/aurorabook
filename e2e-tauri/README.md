# Native Tauri E2E (WebdriverIO)

AuroraBook’s Playwright suite (`bun run test:playwright`) runs the **Vite
frontend with mocked Tauri IPC**. That is fast and CI-friendly, but it does not
exercise the real WebView ↔ Rust boundary.

This folder scaffolds **true native E2E** using Tauri’s recommended stack:

- [WebdriverIO](https://webdriver.io/) + [`@wdio/tauri-service`](https://v2.tauri.app/develop/tests/webdriver/)
- Embedded WebDriver provider (works on macOS / Linux / Windows)

## Prerequisites

1. Build a debug or release desktop binary:

   ```bash
   bun run tauri build
   # or: bun run tauri dev   # keep running while tests execute
   ```

2. Install WDIO deps (not part of the default app install to keep CI light):

   ```bash
   cd e2e-tauri && bun install
   ```

3. Enable the Tauri plugins in a **dev/e2e feature build** (see Plugin setup
   below). Do not ship the WebDriver plugin in App Store releases.

## Run

```bash
# From repo root after building
bun run test:e2e:tauri
```

Or from this directory:

```bash
bunx wdio run wdio.conf.ts
```

Set `TAURI_APP_PATH` if your binary is not at the default release path:

```bash
TAURI_APP_PATH=src-tauri/target/debug/aurorabook bun run test:e2e:tauri
```

## Plugin setup (required once)

Add a Cargo feature and register the plugins only when that feature is on:

```toml
# src-tauri/Cargo.toml
[features]
e2e = []

[dependencies]
tauri-plugin-wdio-webdriver = { version = "2", optional = true }
tauri-plugin-wdio = { version = "2", optional = true }
```

```rust
// in run(), after Builder::default()
#[cfg(feature = "e2e")]
{
    builder = builder
        .plugin(tauri_plugin_wdio_webdriver::init())
        .plugin(tauri_plugin_wdio::init());
}
```

Build with:

```bash
cargo tauri build --features e2e
```

Follow the official guide for current crate versions and macOS entitlements:
https://v2.tauri.app/develop/tests/webdriver/

## What to cover here (vs Playwright mock)

| Flow | Mock Playwright | WDIO Tauri |
| ---- | --------------- | ---------- |
| Library empty / seeded UI | yes | yes |
| Open book → reader HTML | yes (fixture) | yes (SQLite + real EPUB) |
| Ingest EPUB via dialog | no | yes |
| TTS / conversion | no | optional / slow |
| Live audio HTTP server | no | yes |
| Quit / `app-closing` save | no | yes |

Start with the smoke spec in `specs/smoke.e2e.ts`, then add ingest → open →
play using `src-tauri/tests/test_data/*.epub`.
