# iOS Audiobook Export Without FFmpeg

Plan for App Store–safe MP3 / M4A / M4B export on iOS: **no bundled FFmpeg binary, no subprocesses**.

**Status:** Implemented (AVFoundation bridge + MP3 byte-concat)  
**Constraint:** App Store rejects standalone binaries like `ffmpeg`; iOS cannot spawn subprocesses the way desktop export does today.  
**Parity goal:** Same user-facing formats as desktop — **MP3**, **M4A**, **M4B** (with chapter markers where applicable).

**Implementation (branch `cursor/ios-avfoundation-export-5107`):**
- `src-tauri/swift/AudiobookExporter.swift` — `@_cdecl("aurora_export_audiobook")` via AVFoundation composition + `AVAssetExportPresetAppleM4A`
- `src-tauri/src/book_service/ios_export.rs` — MP3 byte-concat, cancel/progress FFI, `get_supported_audio_export_formats`
- `src-tauri/build.rs` — compiles AudiobookExporter alongside NativePlayer for iOS targets
- FE gates export menu items via `get_supported_audio_export_formats`

**Related code:**  
`src-tauri/src/book_service/mp3_export.rs`, `src-tauri/src/utils/ffmpeg_audio.rs`, `src-tauri/src/tts_commands.rs` (in-process LAME), `src/context/AudioExportStateContext.tsx`, `src/components/library/BookDetailDialog.tsx`, `src-tauri/build.rs` (`strip_ffmpeg_from_ios_assets`)

---

## 1. Problem

Desktop export is entirely FFmpeg-driven:

1. Write chapter track blobs to temp files  
2. FFmpeg concat demuxer + re-encode (`libmp3lame` or AAC)  
3. For M4A/M4B: second FFmpeg pass for tags / M4B chapters (`ffmetadata`)

On iOS today:

- FFmpeg is **not** bundled (`tauri.ios.conf.json`; `build.rs` strips any leftover binary)  
- Export helpers are stubbed / gated with `#[cfg(not(target_os = "ios"))]`  
- UI still offers MP3 / M4A / M4B → export fails (often with a misleading “no tracks” / FFmpeg-required error)  
- Conversion already produces **chapter MP3s in-process** via `mp3lame-encoder` — so the *source* for export is available; only the *mux/encode export* path is missing

---

## 2. Goal

| Format | Desktop (keep) | iOS (this plan) |
| :--- | :--- | :--- |
| **MP3** | FFmpeg concat + LAME | In-process concat / Symphonia + LAME |
| **M4A** | FFmpeg AAC + MP4 | AVFoundation / AudioToolbox (native) |
| **M4B** | FFmpeg AAC + chapters | Same native path + chapter metadata |

Shared product behavior: same Tauri commands (`export_as_mp3` / `export_as_m4a` / `export_as_m4b`), progress events, cancel, save dialog. Platform chooses the backend.

Non-goals:

- Shipping FFmpeg / GPL binaries on iOS  
- Changing desktop FFmpeg export (unless sharing a backend trait)  
- Replacing in-chapter TTS encode (already LAME)

---

## 3. Recommended architecture

Introduce a thin **export backend** trait used by `mp3_export`:

```text
AudioExportBackend
  ├── DesktopFfmpegBackend   (current behavior)
  └── IosNativeBackend       (new)
        ├── Mp3: Rust in-process
        └── M4a/M4b: Swift/ObjC bridge → AVFoundation
```

```rust
trait AudioExportBackend: Send + Sync {
    fn export_concat(
        &self,
        tracks: &[PreparedTrack], // bytes + href + duration + title
        format: AudioExportFormat,
        metadata: &ExportMetadata,
        chapters: &[ChapterMarker], // for M4B
        output_path: &Path,
        progress: &dyn Fn(ExportProgress),
        cancel: &AtomicBool,
    ) -> AppResult<()>;
}
```

`export_as_*` stays platform-agnostic: load book/tracks from SQLite → prepare ordered track list → call backend → emit progress.

---

## 4. Format strategies

### 4.1 MP3 (Phase 1 — pure Rust, App Store safe)

Chapter tracks from AuroraBook conversion are already **mono MP3 @ 64 kbps / 44.1 kHz** (`convert_audio_to_mp3` / LAME).

**Primary path (fast):** ordered **byte-concat** of MP3 frames (same pattern as `concatenate_mp3_in_sentence_order`). Works when tracks share compatible stream params (typical for our converted books).

**Fallback path:** if a track is not MP3 or params differ (imported EPUB with mixed audio):

1. Decode with **Symphonia** (already a dependency) → PCM  
2. Encode with **`mp3lame-encoder`** (already used for TTS)  
3. Concatenate PCM then one LAME encode, **or** encode per track then byte-concat if CBR matches

**Metadata (optional v1):** ID3v2 via a small pure-Rust crate (e.g. `id3`) — title/author/album. Not required for first ship.

**Cancel / progress:** cooperative checks between tracks; percent from track index (same UX as desktop).

### 4.2 M4A / M4B (Phase 2 — Apple frameworks)

No in-process AAC encoder exists in the Rust crate today. The vendored `patches/mp4` crate is unused and does not provide AAC encode.

**Recommended:** native iOS bridge (Swift or ObjC++) behind a Tauri/plugin FFI, using:

| Step | API |
| :--- | :--- |
| Decode chapter MP3 → PCM | `AVAudioFile` / `AVAudioConverter` or ExtAudioFile |
| Encode AAC | `AVAssetWriter` + `AVAssetWriterInput` (AAC) |
| Mux MP4/M4A | `AVAssetWriter` output file type `.m4a` / MPEG-4 |
| Chapters (M4B) | timed metadata / chapter track (`AVMutableMetadataItem` / QuickTime chapter atoms) — validate against Books / common players |
| Tags | `AVMetaDataItem` (title, artist, album, …) |

Expose one Rust-callable entry, e.g.:

```text
ios_export_audiobook(
  track_paths_or_blobs[],
  format: m4a|m4b,
  metadata JSON,
  chapter JSON[],
  output_path
) -> Result
```

Run on a background queue; report progress via callback/channel into existing `audio-export-progress` events.

**Alternative (not preferred):** third-party AAC + MP4 mux in Rust (license / App Store / maintenance cost). Prefer Apple codecs.

### 4.3 Why not WASM FFmpeg / static FFmpeg.framework?

- Size, GPL/LGPL redistribution complexity, App Store review risk  
- Still “shipping FFmpeg” in spirit; Apple path is smaller and review-friendlier for AAC/MP4

---

## 5. Implementation phases

### Phase 0 — Honest UX (small, ship ASAP)

1. Detect iOS in FE (`@tauri-apps/plugin-os` / existing platform helpers).  
2. Until backends land: disable or hide M4A/M4B; show MP3 as “coming soon” **or** only enable formats that work.  
3. Fix backend error messages so iOS never claims “no tracks” when the real issue is missing FFmpeg.

### Phase 1 — iOS MP3 export (Rust)

1. `IosNativeBackend` / `export_mp3_inprocess` in `mp3_export` (cfg ios).  
2. Load track bytes via existing `AudioRepository::resolve_track_audio_bytes`.  
3. Homogeneous MP3 → byte-concat; else Symphonia → LAME.  
4. Write to user-chosen path (same save dialog flow).  
5. Progress + cancel via existing atomics/events.  
6. Tests: concat fixture MP3s; mixed-format fallback; cancel mid-run.

**Exit criteria:** Converted book exports a playable single MP3 on device/simulator without FFmpeg.

### Phase 2 — iOS M4A / M4B (AVFoundation bridge)

1. Add Swift (or ObjC) export module linked from `src-tauri` iOS target (pattern similar to `waterkit-background` / existing iOS bridges).  
2. Rust prepares ordered temp files or memory-mapped blobs + metadata/chapters JSON.  
3. Native writer produces `.m4a` / `.m4b`.  
4. Verify chapters in Apple Books / VLC / common players.  
5. Wire cancel (invalidate writer / flag).  

**Exit criteria:** M4A plays; M4B shows chapter list in at least one major player.

### Phase 3 — Polish

1. ID3 on MP3 exports.  
2. Align bitrate/channel with desktop defaults where reasonable (desktop M4A is AAC 128k; chapter sources are 64k MP3 — document that iOS M4A may re-encode).  
3. Share progress/ETA math with desktop.  
4. Optional: desktop could later call the same in-process MP3 path for a FFmpeg-less fallback (not required).

---

## 6. Module sketch

```text
src-tauri/src/book_service/
  mp3_export.rs              // orchestration (unchanged commands)
  export/
    mod.rs                   // AudioExportBackend, select_backend()
    desktop_ffmpeg.rs        // cfg(not(ios)) — move current logic
    ios_mp3.rs               // cfg(ios) — LAME / byte-concat
    ios_avfoundation.rs      // cfg(ios) — FFI to Swift

src-tauri/gen/apple/ or ios bridge/
  AudiobookExporter.swift    // AVAssetWriter pipeline
```

FE:

```text
BookDetailDialog / AudioExportStateContext
  - platformCapabilities.audioExportFormats: ['mp3','m4a','m4b'] from a small command
  - hide unsupported items instead of failing after save dialog
```

---

## 7. Risks

| Risk | Mitigation |
| :--- | :--- |
| Byte-concat MP3 glitches (LAME padding, VBR) | Prefer concat for our CBR conversion output; fallback re-encode; reuse live-playback concat lessons |
| M4B chapter compatibility | Test Apple Books + 1–2 third-party apps; stick to common QuickTime chapter patterns |
| Large books / memory | Stream track-at-a-time to writer; avoid holding all PCM |
| Bridge complexity | Phase 1 MP3 unblocks users; M4A/M4B isolated in Swift |
| Misleading errors today | Phase 0 UX + clear `AppError::Encoding` messages |
| Imported non-MP3 tracks | Symphonia decode path on iOS for MP3 export; for M4A feed PCM into AVAssetWriter |

---

## 8. Testing

- **Unit (Rust):** MP3 byte-concat order; cancel; progress callbacks with mock tracks.  
- **Unit:** Symphonia+LAME round-trip on a tiny fixture WAV/PCM.  
- **Device:** export converted book → Files app → play MP3.  
- **Device:** M4A playback; M4B chapter skip.  
- **Regression:** desktop FFmpeg path unchanged (CI macOS/Windows export tests if any).

---

## 9. Success metrics

- iOS can export **MP3** without FFmpeg or subprocesses  
- iOS can export **M4A** and **M4B** with metadata/chapters via AVFoundation  
- UI only offers formats the current platform supports  
- App Store build contains **no** `ffmpeg` binary (keep existing strip check)

---

## 10. Decision summary

| Decision | Choice |
| :--- | :--- |
| No FFmpeg on iOS | Hard requirement |
| MP3 | In-process Rust (byte-concat + LAME fallback) |
| M4A/M4B | AVFoundation bridge (not pure Rust AAC) |
| Desktop | Keep FFmpeg |
| API surface | Same `export_as_*` commands; backend swap by cfg/runtime |
| Rollout | UX gate → MP3 → M4A/M4B |

---

## 11. Open questions

1. Is **MP3-only on iOS for v1** acceptable if M4A/M4B follow quickly, or must all three ship together?  
2. For M4B, is **Apple Books chapter UX** the primary compatibility target?  
3. Should imported books with non-MP3 tracks block MP3 export with a clear message, or always re-encode via Symphonia+LAME?

---

## Appendix: current touch points

| Area | Path |
| :--- | :--- |
| Export commands | `src-tauri/src/book_service/mp3_export.rs` |
| FFmpeg helpers / iOS stubs | `src-tauri/src/utils/ffmpeg_audio.rs` |
| In-process LAME | `src-tauri/src/tts_commands.rs` |
| Chapter MP3 generation | `src-tauri/src/epub/converter/processing.rs` |
| Strip FFmpeg from iOS assets | `src-tauri/build.rs` |
| FE export menu | `src/components/library/BookDetailDialog.tsx` |
| FE invoke/progress | `src/context/AudioExportStateContext.tsx` |
