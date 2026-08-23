# Parallel Conversion Pipeline

Design plan for a staged, multi-worker conversion pipeline in the Rust backend so EPUB/HTML parsing, TTS synthesis, and audio encoding can overlap on separate cores.

**Status:** Proposal (planning only)  
**Scope:** Desktop/desktop-like targets first (`macOS`, `Windows`, Linux). iOS stays single-worker.  
**Related code:** `src-tauri/src/epub/converter/`, `src-tauri/src/tts/`, `src-tauri/src/utils/ffmpeg_audio.rs`, `src-tauri/src/tts_commands.rs`

---

## 1. Problem

Conversion today is effectively serial:

1. Chapters run one after another in `convert_epub_core_with_durations`.
2. Within a chapter, sentence fan-out already exists (`JoinSet` + `Semaphore` in `process_chapter`), but `get_parallelism()` hard-returns `1`, so only one TTS job runs at a time.
3. Each sentence path does TTS → PCM → LAME MP3 (and live-stream push) on the same async task.
4. TTS inference is synchronous ONNX work inside Tokio tasks, so raising concurrency without a blocking pool can starve the runtime.
5. Chapter MP3 encoding uses in-process LAME (`convert_pcm_to_mp3`), not a dedicated FFmpeg worker stage. FFmpeg is mainly used for export/decode (`mp3_export`, checkpoint restore).

Result: CPU cores sit idle while one stage runs, and wall-clock conversion time is dominated by the sum of parse + TTS + encode rather than the slowest stage.

---

## 2. Goal

Introduce a **bounded, ordered pipeline** with three long-lived worker pools:

| Stage | Responsibility | Output |
| :--- | :--- | :--- |
| **Parse** | Chapter HTML → sentences + span metadata | `ParsedSentence` jobs |
| **TTS** | Sentence text → PCM + word alignments | `SynthesizedSentence` jobs |
| **Encode** | PCM → sentence MP3 (live) and chapter MP3 (final) | Encoded audio + checkpoints |

Stages run concurrently: while TTS synthesizes sentence *N*, Encode can finish *N−1* and Parse can prepare *N+1* (or the next chapter’s sentences).

Non-goals for v1:

- Parallel chapter EPUB rebuild / OPF merge (keep merge sequential for correctness).
- Multiprocess (separate OS processes) unless memory isolation proves necessary.
- Changing the FE “single conversion pipeline” product constraint (one book at a time).
- Replacing SMIL / VTT / words.json semantics.

---

## 3. Current architecture (baseline)

```
convert_epub_to_audiobook_command
  → TtsEnginePool(num_instances = get_parallelism() == 1)
  → for each chapter (sequential):
        extract_all_sentences(HTML)
        JoinSet + Semaphore(N):
          process_sentence → ONNX TTS (sync) → PCM
          encode sentence MP3 (LAME) → live stream + checkpoint
        concat PCM → chapter MP3 (LAME)
        SMIL / spans / VTT / words.json
        merge + rebuild partial EPUB
  → build_final_epub
```

Useful pieces already present:

- `TtsEnginePool` + `TTSKokoParallel` multi-instance support
- Sentence-level `JoinSet` / semaphore / round-robin `worker_id`
- Cancellation via `Arc<AtomicBool>`
- Checkpoint resume + live audio broadcast
- `num_cpus` dependency (currently unused by live `get_parallelism`)

---

## 4. Proposed architecture

### 4.1 Pipeline topology

```
                    ┌─────────────────┐
  chapter HTML ───▶ │  Parse workers  │──┐
                    └─────────────────┘  │
                                         ▼  bounded channel (ordered by seq)
                    ┌─────────────────┐
                    │   TTS workers   │──┐   (N ONNX instances)
                    └─────────────────┘  │
                                         ▼  bounded channel
                    ┌─────────────────┐
                    │ Encode workers  │──┐   (LAME and/or FFmpeg)
                    └─────────────────┘  │
                                         ▼
                              ordered collector
                              (chapter assemble,
                               SMIL/VTT, EPUB merge)
```

Use **Tokio channels** (`mpsc` / `async_channel`) with backpressure, not unbounded queues. Prefer **threads / `spawn_blocking` pools** for CPU-heavy stages so the async runtime stays responsive for DB, progress events, and cancel.

### 4.2 Job types (sketch)

```rust
struct SentenceKey {
    book_id: String,
    chapter_index: usize,
    sentence_index: usize,
}

struct ParsedSentence {
    key: SentenceKey,
    text: String,
    word_count: usize,
    // span metadata needed later for SMIL alignment
}

struct SynthesizedSentence {
    key: SentenceKey,
    pcm: Vec<f32>,           // or Arc<[f32]> / disk spill for large chapters
    alignments: Vec<WordAlignment>,
    duration_sec: f32,
    text: String,
}

struct EncodedSentence {
    key: SentenceKey,
    mp3: Vec<u8>,
    duration_sec: f32,
    // optional: retain pcm handle until chapter concat decides strategy
}
```

Chapter completion is driven by an **ordered collector** that waits until all sentence indices for a chapter are encoded (or restored from checkpoint), then:

1. Concatenate PCM (preferred) or MP3 fallback in sentence order  
2. Write chapter audio + SMIL/VTT/words.json  
3. Merge into `ConversionContext` and rebuild partial EPUB  

This preserves today’s correctness requirements (ordered audio clock, resume, live stream).

### 4.3 Worker sizing

| Pool | Default (desktop) | Cap / notes |
| :--- | :--- | :--- |
| Parse | `1..=2` | HTML/sentence split is usually cheaper than TTS; 1 is often enough |
| TTS | `min(available_cores - reserve, max_onnx_instances)` | Memory-bound: each ONNX instance is large; start with 2, measure RAM |
| Encode | `1..=2` | LAME is lighter than TTS; FFmpeg subprocesses need PID/cancel tracking |

Suggested `get_parallelism()` restoration (desktop only):

```text
reserve 1–2 cores for UI / Tokio / encode
tts_instances = clamp(num_cpus.saturating_sub(reserve), 1, MAX)
ios = always 1
```

Expose overrides later via settings (`conversion.tts_workers`, `conversion.encode_workers`) once defaults are proven safe.

### 4.4 Where work actually runs

| Stage | Execution | Why |
| :--- | :--- | :--- |
| Parse | `spawn_blocking` or small rayon/thread pool | CPU HTML work; avoid blocking Tokio |
| TTS | dedicated blocking threads, one per ONNX instance (or `spawn_blocking` with concurrency = `num_instances`) | ONNX is sync and heavy; must not occupy Tokio worker threads |
| Encode (sentence MP3) | blocking pool | LAME encode today; keep API stable |
| Encode (chapter / export) | optional FFmpeg worker | Align with user intent; reuse `ffmpeg_audio` patterns + cancel PIDs |
| Collector / EPUB merge | async on Tokio | DB, store, events, ordered merge |

### 4.5 FFmpeg’s role in this feature

Clarify stages so “FFmpeg worker” is intentional, not assumed for everything:

**v1 (recommended):** Keep sentence/chapter chapter-path encode on **in-process LAME** (already fast and used for live stream). Run it on a dedicated encode worker pool so it overlaps with TTS.

**v1.5 / v2:** Move **chapter final encode** and/or **export concat** onto an FFmpeg worker queue (`encode_pcm_to_mp3_bytes`, existing export helpers). Benefits: consistent toolchain, easier bitrate/format knobs, offloads LAME from the app process. Costs: process spawn overhead, bundled binary dependency, iOS unavailability (already true for FFmpeg export).

Do **not** put FFmpeg on the hot per-sentence path unless profiling shows LAME is a bottleneck; process spawn per sentence will hurt more than it helps.

---

## 5. Concurrency model (threads vs processes)

**Prefer multithreading inside one process** for v1:

- ONNX Runtime and the existing `TtsEnginePool` are in-process.
- Shared checkpoints, live stream manager, and Tauri app handle are easier with threads.
- Channels + `Arc` job payloads are simpler than IPC.

**Consider multiprocessing later** only if:

- ONNX allocator fragmentation / peak RSS from N model copies is unacceptable, or
- A crashed worker must not take down the UI process.

If multiprocess is ever needed, isolate TTS workers only; keep parse/encode/collector in-process.

---

## 6. Ordering, live stream, and resume

These constraints shape the design more than raw throughput:

1. **Sentence order for chapter audio** — Collector must assemble by `sentence_index`, not completion order (today’s `BTreeMap` pattern).
2. **Live stream** — Push sentence MP3 as soon as Encode finishes that index; do not wait for the whole chapter.
3. **Checkpoints** — Persist encoded sentence audio + alignments as today; on resume, skip Parse/TTS/Encode for restored indices and seed the collector.
4. **Cancellation** — Close channel senders, set cancel flag, drain/abort in-flight TTS/encode, save progress, `clear_global` engine pool (existing behavior).
5. **Progress** — Continue word-based progress; optionally emit stage metrics (`parse_q`, `tts_q`, `encode_q`) for debugging.

---

## 7. Memory & backpressure

TTS PCM buffers dominate RAM. Mitigations:

- Bound channel capacities (e.g. parse→tts depth 8–32, tts→encode depth 4–16).
- Prefer `Arc<[f32]>` and drop PCM after chapter concat when only MP3 is needed long-term.
- Optional disk spill for PCM when chapter length exceeds a threshold.
- Cap `num_instances` by detected RAM as well as CPU (heuristic table per platform).
- Never prefetch-parse an entire book into the TTS queue; feed chapter-by-chapter or with a small chapter lookahead (0–1).

---

## 8. Implementation plan (phased)

### Phase 0 — Unblock safe parallelism (small, high leverage)

1. Restore desktop `get_parallelism()` with conservative defaults (e.g. 2 instances, iOS=1).
2. Wrap TTS inference in `spawn_blocking` (or a dedicated blocking pool sized to `num_instances`).
3. Keep chapter loop sequential; keep LAME on the sentence task initially.
4. Add instrumentation: per-stage timings, peak RSS, sentences/sec.
5. Regression tests: cancel mid-chapter, resume checkpoint, SMIL/audio length alignment.

**Exit criteria:** N=2 is stable on mid-range machines without UI freezes or OOM.

### Phase 1 — Explicit three-stage pipeline inside a chapter

1. Introduce `conversion/pipeline` module: channels, job types, worker supervisors.
2. Split `process_chapter` into:
   - parse producer
   - TTS consumers (pool)
   - encode consumers
   - ordered collector (live push + chapter finalize)
3. Preserve public command APIs and progress event shape.
4. Keep EPUB merge sequential after each chapter completes.

**Exit criteria:** Profile shows overlap (TTS busy while encode busy); identical audio ordering and SMIL timing vs baseline fixtures.

### Phase 2 — Cross-chapter lookahead (optional)

1. Allow parse (and maybe TTS) for chapter `i+1` while collector finalizes chapter `i`.
2. Still serialize EPUB rebuild / store writes.
3. Careful cancel/checkpoint boundaries per chapter.

**Exit criteria:** Measurable wall-clock gain on multi-chapter books without corrupting partial EPUBs.

### Phase 3 — FFmpeg encode worker (optional)

1. Queue chapter-final (and export) jobs to FFmpeg workers with cancel/PID tracking.
2. Keep LAME for low-latency sentence clips unless proven unnecessary.
3. Desktop-only; iOS remains LAME / single-worker.

---

## 9. API / module sketch

Suggested new layout under `src-tauri/src/epub/converter/`:

```text
pipeline/
  mod.rs           // PipelineConfig, run_chapter_pipeline
  jobs.rs          // ParsedSentence, SynthesizedSentence, EncodedSentence
  parse_stage.rs
  tts_stage.rs
  encode_stage.rs
  collector.rs     // ordering, live stream, chapter assemble
```

`process_chapter` becomes a thin wrapper that builds config and calls `run_chapter_pipeline`.

Config knobs (internal first):

```rust
struct PipelineConfig {
    parse_workers: usize,
    tts_workers: usize,      // == ONNX instances
    encode_workers: usize,
    parse_queue_capacity: usize,
    tts_queue_capacity: usize,
    encode_queue_capacity: usize,
    chapter_lookahead: usize, // 0 in phase 1
}
```

---

## 10. Risks

| Risk | Mitigation |
| :--- | :--- |
| Multiple ONNX copies blow RAM | Low default N; RAM heuristic; iOS locked to 1 |
| Tokio starvation from sync ONNX | Mandatory blocking pool for TTS/encode |
| Non-deterministic SMIL / clocks | Ordered collector; reuse existing PCM duration rules |
| Live stream gaps | Encode pushes ASAP; collector tolerates out-of-order completion |
| Harder cancellation | Stage-aware shutdown; don’t accept new jobs after cancel |
| FFmpeg per-sentence overhead | Keep LAME on sentence path |
| Historical instability that forced N=1 | Phase 0 soak tests before pipeline refactor |

---

## 11. Testing strategy

- Unit: channel ordering collector (out-of-order encode → ordered concat).
- Unit: backpressure (slow encode does not unbounded-grow PCM queue).
- Integration: convert fixture EPUB with N=1 vs N=2; compare sentence count, total duration tolerance, SMIL par counts.
- Resume: kill after k sentences; resume; no duplicate/missing indices.
- Cancel: cancel during TTS and during encode; progress persisted; pool cleared.
- Perf smoke (dev only): log stage utilization; expect encode∩tts overlap > 0 on multi-core hosts.

---

## 12. Success metrics

- Wall-clock chapter conversion time ↓ on ≥4-core machines (target: meaningful overlap, not necessarily 2×).
- UI remains responsive during conversion (no multi-second event-loop stalls).
- Peak RSS within accepted budget for default `tts_workers`.
- Zero regressions in checkpoint resume, live playback, and final EPUB media overlays.

---

## 13. Decision summary

| Decision | Choice |
| :--- | :--- |
| Parallelism style | In-process pipeline with bounded channels |
| Granularity | Sentence-level stages; chapters sequential (lookahead later) |
| TTS concurrency | Multi-instance ONNX pool + blocking threads |
| Encode v1 | Dedicated LAME workers overlapping TTS |
| FFmpeg | Chapter/export worker later; not per-sentence |
| iOS | Remain `get_parallelism() == 1` |
| Rollout | Phase 0 safe N>1 → Phase 1 staged pipeline → optional lookahead/FFmpeg |

---

## 14. Open questions for implementation

1. Default desktop `tts_workers`: fixed `2` vs `num_cpus`-based formula?
2. Should PCM stay in memory through chapter concat, or spill to temp files earlier?
3. Is chapter-lookahead worth the complexity before FFmpeg workers?
4. Do we expose worker counts in Settings in v1, or keep them internal until stable?

---

## Appendix: key touch points

| Area | Path |
| :--- | :--- |
| Parallelism knob | `src-tauri/src/epub/converter/progress.rs` (`get_parallelism`) |
| Chapter loop | `src-tauri/src/epub/converter/conversion.rs` |
| Sentence fan-out / encode today | `src-tauri/src/epub/converter/processing.rs` |
| Sentence split | `src-tauri/src/epub/converter/chunking.rs` |
| Engine pool | `src-tauri/src/tts/engine.rs` |
| LAME encode | `src-tauri/src/tts_commands.rs` (`convert_pcm_to_mp3`) |
| FFmpeg helpers | `src-tauri/src/utils/ffmpeg_audio.rs` |
| Export path | `src-tauri/src/book_service/mp3_export.rs` |
| Live stream | `src-tauri/src/book_service/audio_stream.rs` |
| Cancel | `src-tauri/src/epub/cancellation.rs` |
