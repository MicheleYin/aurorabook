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
├── src-tauri/           # Rust backend, Tauri config, icons, resources
├── scripts/             # Build and utility scripts
├── Kokoros/             # Local copy of the Kokoros TTS engine
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
