# Windows Audio Export Without FFmpeg

Plan to remove the desktop Windows runtime dependency on an external FFmpeg executable while preserving the supported audio formats, metadata, and chapter behavior.

**Status:** Planned  
**Current state:** FFmpeg is no longer bundled by the Windows build. Windows export still requires an `ffmpeg.exe` discoverable at runtime.  
**Parity goal:** Keep MP3, M4A, and M4B output, including current tags, chapter markers, progress, cancellation, and supported input audio formats.

## Scope and constraints

- Replace only Windows runtime FFmpeg operations in the first migration; keep macOS behavior independent.
- Do not depend on optional Windows codec packs being installed. Probe the transforms available on supported Windows versions and fail with a specific capability error if parity is unavailable.
- Keep the existing Tauri commands and frontend contract.
- Do not remove FFmpeg runtime discovery until every Windows call site has a native or in-process replacement.
- Android is out of scope.

## Backend direction

Introduce a Windows audio backend behind the existing export orchestration. Use Windows Media Foundation (MF) for Windows-native decode and AAC encoding where the required transforms are present; continue using Symphonia for supported input probing/decoding where it avoids a system-codec dependency. Keep LAME encoding in-process for MP3 output rather than relying on an optional MP3 encoder MFT.

MF Source Reader and Sink Writer are candidates for decoding and AAC mux/encode, but they do not by themselves establish M4B chapter parity. M4B metadata/chapter atoms may need a small MP4 container-writing layer or a proven Rust MP4 muxer. Decide only after testing chapter output in target players.

## Phases

### 0. Inventory and capability baseline

1. Enumerate every Windows call to `utils/ffmpeg_audio.rs` and FFmpeg command construction, distinguishing export, media probing, conversion, and TTS paths.
2. Record the exact current codecs, sample rates, channel layouts, metadata fields, chapter timing, and error/progress behavior used by those paths.
3. Build a small fixture corpus covering MP3, AAC/M4A, WAV/PCM, variable-rate MP3, mixed chapter inputs, Unicode metadata, and books with multiple chapters.
4. Probe MF transforms on clean Windows 10/11 installations and on Windows ARM64; do not treat a developer machine with extra codecs as representative.

**Exit criteria:** Every FFmpeg call site has an owner and a testable parity requirement; codec availability assumptions are documented.

### 1. Native decode and media probing

1. Implement a Windows MF Source Reader adapter for formats Symphonia does not already cover or where MF is required by the existing workflow.
2. Prefer Symphonia for deterministic format probing/decoding when it supports the input; avoid maintaining two paths without a concrete compatibility reason.
3. Normalize both adapters to the same PCM/sample metadata representation and preserve duration/error semantics.
4. Add fixtures for malformed, truncated, and unsupported media.

**Exit criteria:** Windows can probe and decode all currently supported input fixtures without starting FFmpeg.

### 2. MP3 output

1. Reuse `mp3lame-encoder` for a single consistent MP3 encode path.
2. Preserve track order and current bitrate/channel defaults; handle encoder delay/padding and ID3 tags deliberately rather than blindly concatenating incompatible MP3 streams.
3. Add title/artist/album tags and chapter representation only where supported by the existing MP3 behavior.
4. Preserve cooperative cancellation and map encoder progress into existing export events.

**Exit criteria:** MP3 exports play through the final sample, have correct tags, and pass duration/order checks on both x64 and ARM64 Windows.

### 3. M4A and M4B output

1. Use MF Sink Writer with the AAC encoder for M4A after verifying that the encoder is present on every supported Windows edition.
2. Preserve current sample rate, channel layout, bitrate, title, artist, and album metadata.
3. Determine how to emit M4B chapter markers. If MF cannot create the required chapter track/atoms, add a narrowly scoped MP4 metadata/container writer after AAC encoding; do not silently ship M4B without chapters.
4. Validate files with Media Foundation, VLC, and at least one audiobook player that displays chapters.
5. Define behavior when a required encoder is unavailable: clear capability error or a supported in-process fallback, never a generic missing-FFmpeg error.

**Exit criteria:** M4A metadata is correct and M4B chapters are visible and seekable in the agreed target players.

### 4. Replace all Windows FFmpeg call sites

1. Move backend selection behind a platform-specific interface while retaining current command and progress/cancel APIs.
2. Migrate any remaining Windows conversion, probe, and TTS paths found in Phase 0.
3. Run parity tests on x64 and ARM64 clean Windows runners, including packaged NSIS and MSIX layouts.
4. Make Windows error messages describe unsupported codec/encoder capabilities, not FFmpeg availability.

**Exit criteria:** Windows packaged app completes the supported workflows on a clean machine with no FFmpeg installed or on `PATH`.

### 5. Remove Windows runtime FFmpeg dependency

After the prior exit criteria pass, remove Windows FFmpeg lookup from runtime code only if no remaining Windows call sites use it. Keep macOS runtime behavior and development voice-sample generation separate until each has its own migration.

## Main risks

| Risk | Mitigation |
| --- | --- |
| MF codec/transform availability varies by Windows image | Test clean supported OS images and detect capabilities at runtime. |
| MF does not produce compatible M4B chapters | Validate chapter atoms early; use a focused MP4 metadata writer if needed. |
| MP3 encoder delay or VBR makes byte concatenation invalid | Encode the full ordered PCM stream once, or prove compatible-frame concatenation with fixtures. |
| Windows ARM64 differs from x64 | Run the same fixture suite and packaging checks on both architectures. |
| Uncovered FFmpeg call site blocks a full removal | Inventory references first; remove runtime lookup only after all Windows paths are migrated. |

## Verification checklist

- [ ] MP3, M4A, and M4B preserve metadata and playback duration.
- [ ] M4B chapter names, timestamps, ordering, and seeking match current output.
- [ ] Existing input audio formats remain supported or receive an explicit capability error.
- [ ] Progress, cancellation, and failure reporting still use the existing frontend contract.
- [ ] x64 and ARM64 NSIS/MSIX packages run on clean Windows installations without FFmpeg.
- [ ] Runtime FFmpeg lookup remains available on platforms or development workflows that still use it.