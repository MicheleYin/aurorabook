# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)




bun tauri build -- --profile release

codesign --force --deep --sign "Apple Distribution: Michele Yin (YOUR_TEAM_ID)" \
  --entitlements '/Users/micheleyin/Documents/tts-tauri/src-tauri/gen/apple/aurorabook_macOS/aurorabook_macOS.entitlements' \
  AuroraBook.app

productbuild --component AuroraBook.app /Applications \
  --sign "3rd Party Mac Developer Installer: Michele Yin (YOUR_TEAM_ID)" \
  AuroraBook.pkg
