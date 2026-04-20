# Apple Signing

Files in this directory are **gitignored** — never commit them.

## Files that live here (create locally, do not commit)

| File | Purpose |
|------|---------|
| `MacAppStore.provisionprofile` | Mac App Store provisioning profile (download from developer.apple.com) |
| `LOCAL_APPSTORE_BUILD.md` | Personal notes / env var snippets for local Mac App Store builds |
| `LOCAL_IOS_BUILD.md` | Personal notes / env var snippets for local iOS builds |

## Generating Entitlements.macos-appstore.plist

The file `src-tauri/Entitlements.macos-appstore.plist` is **generated** — do not commit it.
Generate it from the template using your Team ID:

```sh
APPLE_TEAM_ID=XXXXXXXXXX bun run scripts/gen-macos-appstore-entitlements.cjs
```

Or set `APPLE_TEAM_ID` in your shell environment and run without the prefix.

## Bundled FFmpeg for Mac App Store

`bun run build:macos:appstore` now verifies a bundled FFmpeg binary at `src-tauri/resources/ffmpeg`.

- If the file is already there, it is reused.
- Otherwise set `MACOS_APPSTORE_FFMPEG=/absolute/path/to/ffmpeg` and the build script copies it into `src-tauri/resources/ffmpeg`.

The App Store signing step re-signs this nested binary with `Entitlements.macos-appstore.nested-exec.plist`.

### Copy FFmpeg into `src-tauri/resources/ffmpeg` (any time)

From `tts-tauri/`:

```bash
bun run sync:ffmpeg -- /path/to/ffmpeg
```

Same as `node scripts/copy-ffmpeg-to-resources.cjs /path/to/ffmpeg`. The destination is gitignored.

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
