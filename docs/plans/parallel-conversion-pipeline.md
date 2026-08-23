# Staged Conversion Pipeline (Single TTS Engine)

Design plan for overlapping EPUB/HTML parse, TTS synthesis, and audio encode so the **one** Supertonic engine stays busy. Stages hand off via bounded queues; they do **not** wait on each other when work is available.

**Status:** Proposal (planning only) — revised after feedback  
**Scope:** All platforms (including iOS): still one ONNX instance. Desktop gains the most from overlapping encode/parse on other cores.  
**Related code:** `src-tauri/src/epub/converter/`, `src-tauri/src/tts/`, `src-tauri/src/utils/ffmpeg_audio.rs`, `src-tauri/src/tts_commands.rs`

---

## 1. Intent (revised)

**Wanted:** Classic producer/consumer pipeline.

```
time →
Parse:   [s0][s1][s2][s3]...
TTS:         [====s0====][====s1====][====s2====]...
Encode:              [s0][s1][s2]...
```

While the engine synthesizes sentence *N*, encode can finish *N−1* and parse can already have *N+1* (and a small buffer) ready. The critical path is almost entirely TTS; parse/encode should rarely stall it.

**Not wanted:** Multiple ONNX / TTS engine instances. No raising `get_parallelism()` for multi-model concurrency. One engine, kept fed.

---

## 2. Problem

Today each sentence does work **serially on the same task**:

```
for sentence:
  TTS(sentence) → PCM
  LAME encode → live stream + checkpoint
```

So after every synthesis, the engine sits idle while encode (and any prep) runs. Parse for the chapter is also done up front as a batch, then the engine starts — fine for one chapter, but chapter finalize (concat, SMIL, EPUB rebuild) still blocks starting the next chapter’s TTS.

Wall-clock ≈ Σ(TTS) + Σ(encode) + Σ(parse/finalize gaps), instead of ≈ Σ(TTS) when the pipeline stays full.

---

## 3. Goal

One **single-engine** pipeline with three stages:

| Stage | Workers | Role |
| :--- | :--- | :--- |
| **Parse** | 1 (enough) | HTML → ordered `ParsedSentence` jobs into a bounded queue |
| **TTS** | **exactly 1** | Pop text → PCM + alignments; never shares the model |
| **Encode** | 1 (optionally 2 if encode ever catches TTS) | PCM → sentence MP3, checkpoint, live push; later chapter/export encode |

Success = **TTS busy fraction high** (engine rarely waiting on an empty input queue or blocked behind encode).

Non-goals:

- Multi-instance `TtsEnginePool` / restoring multi-core `get_parallelism()` for TTS
- Multiprocess workers
- Changing SMIL / VTT / live-stream / checkpoint semantics
- Parallel EPUB rebuild (merge stays sequential)

---

## 4. Current baseline

```
convert_epub_to_audiobook_command
  → TtsEnginePool(num_instances = 1)   // keep this
  → for each chapter (sequential):
        extract_all_sentences(HTML)    // all parse before any TTS
        for each sentence (JoinSet + Semaphore(1)):
          TTS → PCM → LAME → live/checkpoint   // encode blocks next TTS
        concat → chapter MP3 → SMIL/VTT → rebuild EPUB
```

Keep: single engine, cancel token, checkpoints, live stream, ordered `BTreeMap` assemble.  
Change: decouple stages with queues so TTS does not wait on encode/parse.

The existing `JoinSet` + multi-instance scaffolding is incidental; this design does **not** depend on scaling that semaphore for more engines.

---

## 5. Proposed architecture

### 5.1 Topology

```
 chapter HTML
      │
      ▼
 ┌──────────┐   bounded queue    ┌─────────────────────┐   bounded queue    ┌────────────┐
 │  Parse   │ ─────────────────▶ │  TTS (1× ONNX)      │ ─────────────────▶ │   Encode   │
 │  (1)     │   ParsedSentence   │  dedicated thread   │  SynthesizedPCM    │  (1–2)     │
 └──────────┘                    └─────────────────────┘                    └─────┬──────┘
                                                                                  │
                                                                                  ▼
                                                                         ordered collector
                                                                         (live stream,
                                                                          chapter concat,
                                                                          SMIL / EPUB)
```

- **Backpressure:** If encode is slow, the TTS→encode queue fills and TTS blocks on send — rare if encode ≪ TTS. If parse is slow, TTS blocks on recv — avoid with a small prefill (see below).
- **TTS thread:** Run the single ONNX instance on a **dedicated blocking thread** (or `spawn_blocking` with concurrency 1) so Tokio stays free for DB/events/cancel. Encode similarly off the async runtime.

### 5.2 Prefill so the engine never starts cold

Before the TTS loop blocks on an empty queue:

1. Parse starts immediately for the chapter (or next chapter if lookahead is enabled).
2. Prefer a small **input watermark** (e.g. 2–8 parsed sentences buffered) before considering the pipeline “warm.”
3. Target: TTS `recv` wait time ≈ 0 after warmup.

### 5.3 Job types (sketch)

```rust
struct SentenceKey {
    chapter_index: usize,
    sentence_index: usize,
}

struct ParsedSentence {
    key: SentenceKey,
    text: String,
    word_count: usize,
}

struct SynthesizedSentence {
    key: SentenceKey,
    pcm: Arc<[f32]>,
    alignments: Vec<WordAlignment>,
    duration_sec: f32,
    text: String,
}
```

Collector still assembles by `sentence_index` (encode may finish out of order only if encode_workers > 1; with one encode worker, completion order matches TTS order).

### 5.4 Worker sizing (fixed policy)

| Stage | Count | Notes |
| :--- | :--- | :--- |
| Parse | 1 | Cheap vs TTS |
| TTS | **1** | Hard requirement — one engine |
| Encode | 1 | Enough while encode ≪ TTS; raise to 2 only if profiling shows TTS blocked on full encode queue |

Leave `get_parallelism()` at `1` (or repurpose/remove later). Do not load multiple ONNX copies for conversion.

### 5.5 FFmpeg

- **Sentence path:** Keep in-process LAME on the encode stage (low latency for live stream).
- **Chapter final / export:** Optional later move to an FFmpeg job on the encode side so chapter mux does not stall the TTS thread; still one TTS engine.

Do not spawn FFmpeg per sentence.

---

## 6. What overlaps (and what must not)

| Can overlap with TTS | Must stay ordered / gated |
| :--- | :--- |
| Parsing upcoming sentences | Chapter audio concat by sentence index |
| Encoding previous sentence PCM | SMIL/VTT timing derived from final durations |
| Checkpoint I/O / live stream push | EPUB partial rebuild after chapter complete |
| Next-chapter parse (optional lookahead) | Starting next chapter’s TTS only after prior chapter’s audio/SMIL inputs are finalized *or* carefully isolated |

**Chapter lookahead (optional, phase 2):** While encode/collector finishes chapter *i*, parse (and ideally TTS) may already run on chapter *i+1* **if** queues and checkpoints are keyed by chapter. EPUB store write stays serial.

---

## 7. Memory & queues

With one engine, RAM pressure is mostly **PCM sitting between TTS and encode/concat**, not model copies.

- Bound TTS→encode depth tightly (e.g. 2–4 sentences of PCM).
- Bound parse→TTS deeper if needed for watermark (text is cheap).
- Drop or spill PCM after chapter concat when only MP3 is retained.
- Do not parse the entire book into the TTS queue; chapter-scoped feed (+ optional 1-chapter lookahead).

---

## 8. Implementation plan

### Phase 1 — In-chapter stage overlap (core feature)

1. Add `converter/pipeline/` with channels + single TTS consumer + encode consumer + collector.
2. Refactor `process_chapter` so sentence loop is queue-driven, not “TTS then encode on same task.”
3. Move ONNX call onto a dedicated blocking thread; encode on another.
4. Keep `num_instances = 1`, public IPC, progress events, cancel, checkpoints, live stream.
5. Instrument: `tts_idle_ms`, `tts_busy_ms`, queue depths, encode duration vs TTS duration.

**Exit criteria:** For a multi-sentence chapter, TTS idle between sentences drops toward queue/scheduling noise; encode runs concurrently with the next TTS; fixtures match baseline ordering/SMIL.

### Phase 2 — Hide chapter-boundary gaps (optional)

1. Prefetch parse for chapter `i+1` while chapter `i` finalizes.
2. Optionally let TTS continue into `i+1` while `i` encode/EPUB merge completes (harder; needs clear checkpoint boundaries).

**Exit criteria:** Less idle TTS at chapter boundaries on long books.

### Phase 3 — Encode/finalize helpers (optional)

1. Chapter-final MP3 / export via FFmpeg worker so heavy mux never shares the TTS thread.
2. Still one engine.

---

## 9. Module sketch

```text
src-tauri/src/epub/converter/pipeline/
  mod.rs           // run_chapter_pipeline(config, chapter, engine)
  jobs.rs
  parse_stage.rs   // producer
  tts_stage.rs     // single consumer, dedicated thread
  encode_stage.rs  // LAME (+ later FFmpeg chapter jobs)
  collector.rs
```

```rust
struct PipelineConfig {
    // tts_workers is intentionally absent / always 1
    encode_workers: usize,          // default 1
    parse_to_tts_capacity: usize,   // watermark-friendly
    tts_to_encode_capacity: usize,  // small (PCM-heavy)
    chapter_lookahead: usize,       // 0 in phase 1
}
```

---

## 10. Risks

| Risk | Mitigation |
| :--- | :--- |
| Encode still serializes TTS if left on same task | Hard split: TTS thread never calls LAME |
| Empty TTS queue (parse too late) | Prefill watermark; measure `tts_idle_ms` |
| Full encode queue blocks TTS | Keep encode fast (LAME); capacity ≥ 2; optional 2nd encode worker |
| Chapter finalize stalls next TTS | Phase 2 lookahead |
| Tokio stalls from sync ONNX | Dedicated blocking thread for the one engine |
| Over-building multi-engine pool | Do not expand `get_parallelism()` for this feature |

---

## 11. Testing

- Unit: pipeline with mock slow encode / fast TTS → TTS still progresses while encode runs.
- Unit: backpressure when encode paused → TTS blocks on full queue, no unbounded PCM growth.
- Integration: same chapter fixture vs current path — sentence count, duration tolerance, SMIL pars.
- Resume / cancel unchanged expectations.
- Perf signal: `tts_busy_ms / (tts_busy_ms + tts_idle_ms)` high after warmup.

---

## 12. Success metrics

- Primary: **TTS utilization** high for the bulk of each chapter (engine stays mostly running).
- Secondary: Wall-clock ↓ by roughly the overlapped encode/parse time (often modest vs TTS, but free).
- UI stays responsive (ONNX off Tokio worker threads).
- No multi-engine memory cost; RSS similar to today’s single-instance conversion.

---

## 13. Decision summary

| Decision | Choice |
| :--- | :--- |
| TTS engines | **Exactly one** |
| Parallelism model | Stage overlap via queues, not multi-model fan-out |
| Encode | Separate stage (LAME first) overlapping TTS |
| Parse | Producer feeding TTS; small prefill |
| `get_parallelism()` | Stay at 1; not the lever for this feature |
| FFmpeg | Optional chapter/export encode later |
| Rollout | Phase 1 in-chapter pipeline → optional boundary lookahead |

---

## 14. Open questions

1. Phase 2: only prefetch **parse** for the next chapter, or also let **TTS** cross the chapter boundary before EPUB rebuild finishes?
2. Encode workers: lock to 1 unless metrics show TTS blocked on a full encode queue?
3. Keep or delete unused multi-instance pool paths later (cleanup, not required for v1)?

---

## Appendix: key touch points

| Area | Path |
| :--- | :--- |
| Chapter processing | `src-tauri/src/epub/converter/processing.rs` |
| Chapter loop / finalize | `src-tauri/src/epub/converter/conversion.rs` |
| Sentence split | `src-tauri/src/epub/converter/chunking.rs` |
| Single engine pool | `src-tauri/src/tts/engine.rs` |
| LAME | `src-tauri/src/tts_commands.rs` |
| FFmpeg | `src-tauri/src/utils/ffmpeg_audio.rs` |
| Live stream / checkpoints | `src-tauri/src/book_service/audio_stream.rs`, checkpoint repo |
| Cancel | `src-tauri/src/epub/cancellation.rs` |
