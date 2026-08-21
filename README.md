<div align="center">

# AuroraBook

**A high-performance EPUB reader with native Text-to-Speech (TTS) capabilities.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](https://reactjs.org/)

*Read your favorite books with high-quality AI voices—offline and on the go.*

![AuroraBook Logo](logo-svg.png)

</div>

---

## Why AuroraBook?

AuroraBook is designed for book lovers who want a seamless reading and listening experience. By integrating the powerful Kokoros TTS engine directly into a native shell, AuroraBook offers ultra-fast high-quality speech synthesis without the need for an internet connection.

- **Offline TTS** — High-quality AI voices running locally on your hardware.
- **EPUB Support** — Import and read your EPUB library with ease.
- **Live Sync** — Follow along as the text is highlighted during speech synthesis.
- **Cross-Platform** — Native experience on macOS and iOS.
- **Privacy First** — Your books and data stay on your device.

---

## Features at a glance

| Feature | Description |
| :--- | :--- |
| **Reader** | Clean, customizable reading interface for EPUB files |
| **TTS Engine** | Powered by [Kokoros](https://github.com/MicheleYin/kokoros) (ONNX) |
| **Voices** | Multiple natural-sounding voices with adjustable speed |
| **Audiobooks** | Convert EPUB chapters to high-quality audio offline |
| **Layout** | Responsive design optimized for both desktop and mobile |

---

## Tech stack

| Layer | Choice |
| ------ | ------ |
| **UI** | [React](https://reactjs.org/), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/) |
| **State** | [Redux Toolkit](https://redux-toolkit.js.org/) |
| **Shell** | [Tauri 2](https://tauri.app/) (Rust) |
| **TTS** | [Kokoros](https://github.com/MicheleYin/kokoros) (ONNX Runtime) |
| **EPUB** | [Epub.js](https://github.com/futurepress/epub.js/) |

---

## Prerequisites

- **[Rust](https://www.rust-lang.org/tools/install)** (stable) and platform build tools for Tauri ([prerequisites](https://v2.tauri.app/start/prerequisites/))
- **[Bun](https://bun.sh/)** (recommended) or **Node.js**
- **iOS Build Tools** (for iOS builds): Xcode, `xcrun`, etc.

---

## Getting started

```bash
# Install dependencies
bun install

# Run the app in development (starts Vite + Tauri)
bun run dev:debug
```

For advanced logging:
```bash
# Run with trace level logs
bun run dev:trace
```

---

## Testing & coverage

### Testing pyramid (Tauri-aware)

| Layer | Command | What it covers |
| ----- | ------- | -------------- |
| Frontend unit | `bun run test` | Vitest — lib/hooks/contexts (Tauri mocked) |
| IPC contracts | included in Vitest + `bun run test:rust` | Shared JSON fixtures under `tests/fixtures/ipc/` |
| Browser E2E | `bun run test:e2e` | Playwright + Vite with `VITE_E2E_MOCK=1` (real UI, mocked IPC) |
| Native E2E | `bun run test:e2e:tauri` | WebdriverIO → real Tauri WebView (see `e2e-tauri/`) |
| Rust unit/integration | `bun run test:rust` | Fast lib + modular harness (incl. IPC wire tests) |

### Frontend

```bash
# Unit / component tests (Vitest)
bun run test
bun run test:watch
bun run test:coverage   # → coverage/lcov.info + HTML under coverage/

# Browser E2E (Vite + mocked Tauri IPC — CI-friendly)
bun run test:e2e
# alias: bun run test:playwright

# Unit + Playwright
bun run test:all
```

Co-locate tests as `src/**/*.{test,spec}.{ts,tsx}`. Tauri APIs are stubbed in
[`src/test/setup.ts`](src/test/setup.ts) for Vitest. Playwright uses
[`src/test/e2e/`](src/test/e2e/) shims when `VITE_E2E_MOCK=1`.

### Native Tauri E2E

True WebView ↔ Rust flows (ingest, SQLite, audio server) require WebdriverIO:

```bash
# One-time: install WDIO deps and wire the e2e Cargo feature (see README there)
cd e2e-tauri && bun install
bun run test:e2e:tauri
```

Details: [`e2e-tauri/README.md`](e2e-tauri/README.md).

### Rust

```bash
# Fast suite (lib + modular harness) — same as CI
bun run test:rust

# Coverage via cargo-llvm-cov (install once:
#   cargo install cargo-llvm-cov --locked
#   rustup component add llvm-tools-preview)
bun run test:rust:coverage   # → src-tauri/target/llvm-cov/lcov.info

# Lib unit tests only
bun run test:rust:lib

# Full suite including slow/model/FFmpeg binaries
cd src-tauri && cargo test
```

See [`src-tauri/tests/README.md`](src-tauri/tests/README.md) for the fast vs
slow/ignored policy. CI uploads FE and Rust LCOV artifacts from
[`.github/workflows/test.yml`](.github/workflows/test.yml).

---

## Building

### macOS
```bash
# Build the application (unsigned)
bun run build:macos:unsigned

# Build and sign for Mac App Store (Local)
# See src-tauri/signing/LOCAL_APPSTORE_BUILD.md for setup
bun run build:macos:appstore
```

### iOS
```bash
# Build ONNX Runtime for iOS (Required for first-time iOS builds)
./scripts/build-onnxruntime-ios.sh

# Build the iOS app
bun run build:ios
```

---

## Project layout

```
├── src/                 # React + TypeScript frontend
├── src/test/            # Vitest setup + Tauri mocks
├── src/test/e2e/        # Playwright mock-Tauri shims (VITE_E2E_MOCK)
├── src-tauri/           # Rust backend, Tauri config, icons, resources
├── src-tauri/tests/     # Rust integration / modular test suite
├── tests/               # Playwright browser E2E specs + IPC fixtures
├── e2e-tauri/           # Native WebdriverIO + Tauri E2E scaffold
├── scripts/             # Build, coverage, and utility scripts
└── package.json         # Scripts and frontend dependencies
```

---

## Contributing

Contributions are welcome!

1. Fork the repo and create a branch for your change.
2. Keep commits focused; match existing style where possible.
3. Open a PR with a short description of **what** and **why**.

---

## License

This project is released under the [MIT License](LICENSE).

---

## Acknowledgements

- [Kokoros](https://github.com/MicheleYin/kokoros) — Local TTS engine inspiration
- [Tauri](https://tauri.app/) — Lightweight native apps
- [ONNX Runtime](https://onnxruntime.ai/) — High-performance ML inference
- [Epub.js](http://epubjs.org/) — EPUB rendering in the browser
- [Lucide](https://lucide.dev/) — Beautifully simple icons

<div align="center">

**Happy Reading.**

</div>
