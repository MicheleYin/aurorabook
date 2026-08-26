# Code signing (Apple & Microsoft)

Files in this directory are **gitignored** except this README — never commit certificates, provisioning profiles, or Partner Center secrets.

## Files that live here (create locally, do not commit)

| File | Purpose |
|------|---------|
| `MacAppStore.provisionprofile` | Mac App Store provisioning profile (download from developer.apple.com) |
| `LOCAL_APPSTORE_BUILD.md` | Personal notes / env var snippets for local Mac App Store builds |
| `LOCAL_IOS_BUILD.md` | Personal notes / env var snippets for local iOS builds |
| `LOCAL_WINDOWS_STORE_BUILD.md` | Partner Center app id, publisher CN, submission notes |
| `Package.appxmanifest` | Optional copy of your MSIX manifest (if not kept at repo root) |
| `devcert.pfx` | Self-signed cert for **local** MSIX sideload testing only |

---

## Microsoft Store (Windows) — local MSIX build

AuroraBook publishes to the Microsoft Store as **MSIX** via [winapp CLI](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/tauri). The Store re-signs the package after certification — you do **not** need a commercial code-signing certificate for Store submission.

Your existing CI workflow (`.github/workflows/build-windows.yml`) builds unsigned **NSIS** installers. Store builds are a separate, local pipeline:

```
bun run build:windows:store:x64     # or :arm64
        ↓
msix-layout/{arch}/                 # staged exe + DLLs + resources
        ↓
winapp pack                         # unsigned .msix (Store) or signed (local test)
        ↓
Partner Center → Submit for certification
```

### Prerequisites (Windows 11 machine)

1. **Microsoft Partner Center** — [register](https://developer.microsoft.com/microsoft-store/register) (Individual or Company; currently free).
2. **Reserve the app name** — Partner Center → Apps & games → New product → MSIX/PWA.
3. **Visual Studio 2022 Build Tools** — [Desktop development with C++](https://visualstudio.microsoft.com/visual-cpp-build-tools/) workload.
   - **x64 builds:** MSVC x64/x86 build tools (included in the default C++ workload).
   - **ARM64 builds (cross-compile from x64 PC):** also install **MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools** via Visual Studio Installer → Individual components.
   - Regular PowerShell does not put `cl.exe` on `PATH`; the repo's build scripts call `scripts/with-msvc-env.cjs` automatically. Alternatively use **x64 Native Tools Command Prompt for VS 2022**.
4. **winapp CLI** — `winget install microsoft.winappcli --source winget`
5. **Rust + Bun + Node** — same as normal Windows builds (`rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc`).
6. **Supertonic models** — clone `./supertonic-3` with Git LFS (same as CI).

### One-time setup: `winapp init`

From the repo root in PowerShell:

```powershell
winapp init
```

This creates `Package.appxmanifest` (or `appxmanifest.xml`) and an `Assets/` folder at the repo root.

When prompted, align identity with Partner Center:

| Field | AuroraBook value |
|-------|------------------|
| **Name / package identity** | Must match the reserved Store name (e.g. `MicheleYin.AuroraBook`) |
| **Publisher** | Must match Partner Center exactly (e.g. `CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`) |
| **Version** | Four-part semver from `src-tauri/tauri.conf.json` (e.g. `3.3.2.0`) |
| **Executable** | Use `$targetnametoken$.exe` placeholder (winapp resolves `aurorabook.exe` at pack time) |

Copy Store logo assets from `src-tauri/icons/` into `Assets/` if `winapp init` did not populate them (see `scripts/generate-icons.sh` for Windows Store sizes).

**Automated sync (recommended):** before every MSIX pack, run:

```powershell
node scripts/generate-wide-tile.cjs   # once, or after icon changes
node scripts/sync-windows-store-assets.cjs
```

Store build scripts (`build:windows:store:*`) and `pack:windows:msix*` call the sync script automatically. It copies:

| `Assets/` (manifest) | Source |
|----------------------|--------|
| `StoreLogo.png` | `src-tauri/icons/StoreLogo.png` (50×50) |
| `AppList.png` | `src-tauri/icons/Square44x44Logo.png` (44×44) |
| `MedTile.png` | `src-tauri/icons/Square150x150Logo.png` (150×150) |
| `WideTile.png` | `src-tauri/icons/Wide310x150Logo.png` (**310×150**, not Square310x310) |

If `Wide310x150Logo.png` is missing, run `node scripts/generate-wide-tile.cjs` first.

### Pre-submission checklist (tile icons / policy 10.1.1.11)

Before uploading to Partner Center:

1. **Generate wide tile** (if icons changed): `node scripts/generate-wide-tile.cjs`
2. **Sync assets**: `node scripts/sync-windows-store-assets.cjs` (must pass with no errors)
3. **Build MSIX**: `bun run build:windows:store:x64` (and arm64 / bundle if needed)
4. **Verify package contents**: rename `.msix` → `.zip`, extract, confirm `Assets/` has all four PNGs with correct sizes (50, 44, 150, 310×150)
5. **Local smoke test** (optional): install signed MSIX, pin to Start, confirm AuroraBook branding appears (not the gray default placeholder)
6. **Bump version** in `Package.appxmanifest` above any previously submitted package (keep in sync with `src-tauri/tauri.conf.json`)

Optional: keep a personal copy of env-specific values in `LOCAL_WINDOWS_STORE_BUILD.md` (gitignored).

### Local dev certificate (testing only)

Only needed to **install the MSIX locally** before Store submission:

```powershell
# From repo root (Publisher is taken from Package.appxmanifest)
winapp cert generate --output src-tauri\signing\devcert.pfx --install

# Or generate + install in two steps (install needs an elevated PowerShell):
# winapp cert generate --output src-tauri\signing\devcert.pfx
# winapp cert install src-tauri\signing\devcert.pfx
```

Then **re-pack signed** (layout already exists after a Store build):

```powershell
$env:WINAPP_DEV_CERT = "src-tauri\signing\devcert.pfx"
$env:WINAPP_DEV_CERT_PASSWORD = "password"
bun run pack:windows:msix -- --arch=x64
```

Install and launch:

```powershell
Add-AppxPackage -Path .\AuroraBook_3.3.2.0.msix
# or double-click the .msix in Explorer
```

Skip the cert for Store uploads — submit an **unsigned** `.msix` / `.msixbundle`.

### Local Store smoke test (fast loop)

Use this to catch MSIX-only issues (missing frameworks, tile assets, sandbox paths) before Partner Center upload.

**One-time setup**

1. **VCLibs framework** — required on clean VMs; MSIX cannot use `System32\MSVCP140.dll` unless the manifest declares it. Install once per architecture:

```powershell
# x64 (most dev PCs)
Add-AppxPackage 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx'

# ARM64 (Surface / ARM test device)
Add-AppxPackage 'https://aka.ms/Microsoft.VCLibs.arm64.14.00.Desktop.appx'
```

2. **Dev signing cert** (see above): `winapp cert generate --output src-tauri\signing\devcert.pfx --install`

3. **`winapp init`** + Partner Center identity in `Package.appxmanifest` (if not done yet)

**Full build + install**

```powershell
$env:WINAPP_DEV_CERT = "src-tauri\signing\devcert.pfx"
$env:WINAPP_DEV_CERT_PASSWORD = "password"
bun run build:windows:store:x64
Add-AppxPackage -Path .\AuroraBook_<version>.msix
```

Launch from Start → AuroraBook. If a previous sideload is installed, bump `Version` in `Package.appxmanifest` or remove first:

```powershell
Get-AppxPackage MicheleYin.Aurorabook | Remove-AppxPackage
```

**Fast re-test after code changes** (skip full `tauri build` when only re-packing):

```powershell
# Rebuild exe only
node scripts/ensure-windows-ffmpeg-resource.cjs --arch=x64
node scripts/bundle-windows-directml.cjs --arch=x64
node scripts/with-msvc-env.cjs --target x86_64-pc-windows-msvc -- node scripts/tauri-cli.cjs build --no-bundle --target x86_64-pc-windows-msvc -c src-tauri/tauri.windows.conf.json
node scripts/ensure-windows-ort-dlls.cjs --arch=x64 --require-dawn
node scripts/stage-windows-msix-layout.cjs --arch=x64

# Re-pack + install (signed)
$env:WINAPP_DEV_CERT = "src-tauri\signing\devcert.pfx"
$env:WINAPP_DEV_CERT_PASSWORD = "password"
bun run pack:windows:msix -- --arch=x64
Add-AppxPackage -Path .\AuroraBook_<version>.msix
```

`pack-windows-msix` automatically adds the `Microsoft.VCLibs.140.00.UWPDesktop` dependency to your manifest via `scripts/ensure-windows-msix-vclibs-dependency.cjs`.

### MSVCP140.dll / “MSVP140.dll was not found”

**Symptom:** App fails immediately on launch from the Store MSIX (or sideload), even though the same `.exe` works when built/run outside MSIX on a dev PC with Visual Studio installed.

**Cause:** Rust/MSVC builds link dynamically against `MSVCP140.dll` and `MSVCP140_1.dll`. Packaged apps must declare:

```xml
<Dependencies>
  <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.18362.0" MaxVersionTested="10.0.26200.0" />
  <PackageDependency Name="Microsoft.VCLibs.140.00.UWPDesktop" MinVersion="14.0.33728.0" Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" />
</Dependencies>
```

Do **not** copy those DLLs beside the exe for Store builds — Microsoft delivers them via the framework package at install time.

**NSIS `.exe` installs** (CI) are not sandboxed; they rely on the user having the [VC++ 2015–2022 redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) installed, which most Windows 10/11 PCs already have.

### Build commands

**x64 (WebGPU + DirectML):**

```powershell
bun run build:windows:store:x64
```

**ARM64 (DirectML only):**

```powershell
bun run build:windows:store:arm64
```

**Both architectures → `.msixbundle` (recommended for Store):**

```powershell
bun run build:windows:store:x64
bun run build:windows:store:arm64
bun run pack:windows:msix:bundle
```

Each arch script: stages FFmpeg/DirectML → `tauri build --no-bundle` → stages `msix-layout/` → syncs Store tile assets → runs `winapp pack`.

### What gets staged

The MSIX layout mirrors the installed NSIS app:

- `aurorabook.exe`
- `DirectML.dll` (+ `webgpu_dawn.dll`, `dxil.dll`, `dxcompiler.dll` on x64) **beside the exe**
- `resources/` (TTS models, FFmpeg, voice samples, ort-dylibs)

### Bump version before each submission

Windows requires a **higher** four-part version in `Package.appxmanifest` than any previously submitted package. Keep it in sync with `src-tauri/tauri.conf.json`.

### Submit to Partner Center

**Portal (manual):**

1. Partner Center → your app → Start submission.
2. Upload the `.msix` or `.msixbundle` from the repo root.
3. Complete listing (description, screenshots, category, age rating, markets, privacy policy).
4. Submit for certification.

**CLI (optional):**

```powershell
winapp store app list
winapp store publish .\AuroraBook_3.3.2.0.msixbundle --appId <your-partner-center-app-id>
```

See [Microsoft Store Developer CLI](https://aka.ms/msstoredevcli/docs).

### Why not submit the NSIS `.exe`?

Store accepts EXE/MSI installers, but they must be **CA-signed** and hosted at a fixed HTTPS URL. MSIX via winapp avoids buying a code-signing cert and matches Store auto-update behavior.

---

## Apple Signing

### Generating Entitlements.macos-appstore.plist

Non–App Store / CI builds use the committed `src-tauri/Entitlements.macos.plist`
(no Team ID). Mac App Store builds still use a **generated**
`src-tauri/Entitlements.macos-appstore.plist` — do not commit it.
Generate it from the template using your Team ID:

```sh
APPLE_TEAM_ID=XXXXXXXXXX bun run scripts/gen-macos-appstore-entitlements.cjs
```

Or set `APPLE_TEAM_ID` in your shell environment and run without the prefix.

### Bundled FFmpeg for macOS

macOS builds bundle a self-contained FFmpeg directory at `src-tauri/resources/ffmpeg-bin/`
(executable + dylibs). iOS builds never include FFmpeg.

- `bun run build:macos` and `bun run build:macos:appstore` run `ensure-macos-ffmpeg-resource.cjs` first.
- Auto-detects Homebrew ffmpeg when present; override with `AURORABOOK_FFMPEG` or `MACOS_APPSTORE_FFMPEG`.
- Manual staging: `bun run sync:ffmpeg -- /path/to/ffmpeg` or `bun run bundle:ffmpeg:macos`.

The App Store signing step re-signs the nested ffmpeg binary (and bundled dylibs) with
`Entitlements.macos-appstore.nested-exec.plist`.

## Bundled FFmpeg for Windows

Windows builds stage a pinned **BtbN FFmpeg n8.1 static GPL** binary at
`src-tauri/resources/ffmpeg-bin/ffmpeg.exe` (includes `libmp3lame` + AAC/MP4).

- `bun run build:windows` / `build:windows:arm64` run `ensure-windows-ffmpeg-resource.cjs` first.
- Download/stage: `bun run bundle:ffmpeg:windows` (set `AURORABOOK_FFMPEG_ARCH=arm64` for ARM64).
- Override with a local binary via `AURORABOOK_FFMPEG` or `bun run sync:ffmpeg -- path\to\ffmpeg.exe`.

## ONNX Runtime execution providers (desktop)

| Platform | EP |
| -------- | -- |
| macOS | WebGPU (Dawn dylib in `resources/ort-dylibs/`) |
| Windows x86_64 | WebGPU (`webgpu_dawn.dll` + `DirectML.dll` next to `AuroraBook.exe`) |
| Windows ARM64 | DirectML (`DirectML.dll` next to the exe; see `tauri.windows-arm64.conf.json`) |
| iOS | CPU only |

On Windows, helper DLLs are **load-time** dependencies — they must sit beside the `.exe`,
not only under `resources/`.

- x64: `tauri.windows.conf.json` maps Dawn + DirectML to the install root; `beforeBundleCommand`
  runs `ensure-windows-ort-dlls.cjs`.
- ARM64: `tauri.windows-arm64.conf.json` maps DirectML only (no Dawn). DirectML comes from
  pinned **Microsoft.AI.DirectML 1.15.4** (`bun run bundle:directml:windows`).
- System `DirectML.dll` is often too old; shipping the redistributable avoids
  `STATUS_ENTRYPOINT_NOT_FOUND` / EP registration failures.

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
