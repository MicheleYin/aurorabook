# Apple Signing

Files in this directory are **gitignored** — never commit them.

## Files that live here (create locally, do not commit)

| File | Purpose |
|------|---------|
| `MacAppStore.provisionprofile` | Mac App Store provisioning profile (download from developer.apple.com) |
| `LOCAL_APPSTORE_BUILD.md` | Personal notes / env var snippets for local Mac App Store builds |
| `LOCAL_IOS_BUILD.md` | Personal notes / env var snippets for local iOS builds |

## Generating Entitlements.macos-appstore.plist

Non–App Store / CI builds use the committed `src-tauri/Entitlements.macos.plist`
(no Team ID). Mac App Store builds still use a **generated**
`src-tauri/Entitlements.macos-appstore.plist` — do not commit it.
Generate it from the template using your Team ID:

```sh
APPLE_TEAM_ID=XXXXXXXXXX bun run scripts/gen-macos-appstore-entitlements.cjs
```

Or set `APPLE_TEAM_ID` in your shell environment and run without the prefix.

## Bundled FFmpeg for macOS

macOS builds bundle a self-contained FFmpeg directory at `src-tauri/resources/ffmpeg-bin/`
(executable + dylibs). iOS builds never include FFmpeg.

- `bun run build:macos` and `bun run build:macos:appstore` run `ensure-macos-ffmpeg-resource.cjs` first.
- Auto-detects Homebrew ffmpeg when present; override with `AURORABOOK_FFMPEG` or `MACOS_APPSTORE_FFMPEG`.
- Manual staging: `bun run sync:ffmpeg -- /path/to/ffmpeg` or `bun run bundle:ffmpeg:macos`.

The App Store signing step re-signs the nested ffmpeg binary (and bundled dylibs) with
`Entitlements.macos-appstore.nested-exec.plist`.

## Regenerating src-tauri/gen/apple/ (Xcode project)

The `src-tauri/gen/apple/` directory is also gitignored because it contains your Team ID.
Regenerate it any time with:

```sh
cargo tauri ios init
```

or equivalently:

```sh
bunx tauri ios init
```
