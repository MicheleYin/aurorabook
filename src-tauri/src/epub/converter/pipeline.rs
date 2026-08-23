//! Single-engine conversion pipeline: Parse → TTS → Encode stage overlap.
//!
//! Exactly one TTS synthesizer runs at a time. Encode of sentence *N* overlaps
//! with TTS of sentence *N+1* via a bounded queue so the engine stays fed.

use crate::tts::koko::WordAlignment;
use crate::utils::constants::SAMPLE_RATE;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// Queue depths for the single-engine pipeline.
#[derive(Debug, Clone, Copy)]
pub struct PipelineConfig {
    /// Parsed sentences buffered ahead of TTS (text is cheap).
    pub parse_to_tts_capacity: usize,
    /// PCM jobs buffered between TTS and encode (keep small — PCM is heavy).
    pub tts_to_encode_capacity: usize,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            parse_to_tts_capacity: 8,
            tts_to_encode_capacity: 2,
        }
    }
}

/// Sentence ready for TTS (already extracted / ordered).
#[derive(Debug, Clone)]
pub struct ParsedJob {
    pub index: usize,
    pub text: String,
}

/// Fully synthesized + encoded sentence result.
#[derive(Debug, Clone)]
pub struct EncodedJob {
    pub index: usize,
    pub text: String,
    pub pcm: Vec<f32>,
    pub alignments: Vec<WordAlignment>,
    pub duration_sec: f32,
    pub mp3: Vec<u8>,
}

/// Instrumentation collected while the pipeline runs.
#[derive(Debug, Clone, Default)]
pub struct PipelineStats {
    pub sentences_completed: usize,
    pub tts_busy_ms: u64,
    pub tts_idle_ms: u64,
    pub encode_busy_ms: u64,
    /// Highest observed depth of the TTS→encode queue.
    pub max_tts_to_encode_depth: usize,
}

struct SynthesizedJob {
    index: usize,
    text: String,
    pcm: Vec<f32>,
    alignments: Vec<WordAlignment>,
    duration_sec: f32,
}

/// Handle returned by [`start_sentence_pipeline`].
pub struct PipelineHandle {
    pub output_rx: mpsc::Receiver<EncodedJob>,
    worker: JoinHandle<anyhow::Result<PipelineStats>>,
}

impl PipelineHandle {
    /// Wait for workers to finish and return aggregate stats.
    pub async fn join(self) -> anyhow::Result<PipelineStats> {
        self.worker
            .await
            .map_err(|e| anyhow::anyhow!("Pipeline worker join error: {:?}", e))?
    }

    /// Abort in-flight workers (e.g. after cancel).
    pub fn abort(&self) {
        self.worker.abort();
    }
}

fn cancelled(token: &Option<Arc<AtomicBool>>) -> bool {
    token
        .as_ref()
        .map(|t| t.load(Ordering::Relaxed))
        .unwrap_or(false)
}

fn cancel_err() -> anyhow::Error {
    anyhow::anyhow!("Conversion cancelled by user")
}

/// Start Parse→TTS→Encode with a **single** TTS worker.
///
/// Encoded sentences are pushed to [`PipelineHandle::output_rx`] as encode finishes.
/// With one encode worker, output order matches TTS / input order.
pub fn start_sentence_pipeline<S, E>(
    jobs: Vec<ParsedJob>,
    config: PipelineConfig,
    cancel_token: Option<Arc<AtomicBool>>,
    synthesize: S,
    encode: E,
) -> PipelineHandle
where
    S: Fn(usize, String) -> anyhow::Result<(Vec<f32>, Vec<WordAlignment>, String)>
        + Send
        + Sync
        + 'static,
    E: Fn(Vec<f32>) -> anyhow::Result<(Vec<f32>, Vec<u8>)> + Send + Sync + 'static,
{
    let parse_cap = config.parse_to_tts_capacity.max(1);
    let encode_cap = config.tts_to_encode_capacity.max(1);
    let (out_tx, out_rx) = mpsc::channel::<EncodedJob>(encode_cap);

    let worker = tokio::spawn(async move {
        run_pipeline_workers(
            jobs,
            parse_cap,
            encode_cap,
            cancel_token,
            synthesize,
            encode,
            out_tx,
        )
        .await
    });

    PipelineHandle { output_rx: out_rx, worker }
}

async fn run_pipeline_workers<S, E>(
    jobs: Vec<ParsedJob>,
    parse_cap: usize,
    encode_cap: usize,
    cancel_token: Option<Arc<AtomicBool>>,
    synthesize: S,
    encode: E,
    out_tx: mpsc::Sender<EncodedJob>,
) -> anyhow::Result<PipelineStats>
where
    S: Fn(usize, String) -> anyhow::Result<(Vec<f32>, Vec<WordAlignment>, String)>
        + Send
        + Sync
        + 'static,
    E: Fn(Vec<f32>) -> anyhow::Result<(Vec<f32>, Vec<u8>)> + Send + Sync + 'static,
{
    if cancelled(&cancel_token) {
        return Err(cancel_err());
    }

    let total = jobs.len();
    if total == 0 {
        return Ok(PipelineStats::default());
    }

    let (parse_tx, mut parse_rx) = mpsc::channel::<ParsedJob>(parse_cap);
    let (synth_tx, mut synth_rx) = mpsc::channel::<SynthesizedJob>(encode_cap);

    let tts_busy_ms = Arc::new(AtomicU64::new(0));
    let tts_idle_ms = Arc::new(AtomicU64::new(0));
    let encode_busy_ms = Arc::new(AtomicU64::new(0));
    let max_depth = Arc::new(AtomicUsize::new(0));
    let encode_queue_depth = Arc::new(AtomicUsize::new(0));
    let completed = Arc::new(AtomicUsize::new(0));

    let synthesize = Arc::new(synthesize);
    let encode = Arc::new(encode);

    let feeder_cancel = cancel_token.clone();
    let feeder = tokio::spawn(async move {
        for job in jobs {
            if cancelled(&feeder_cancel) {
                return Err(cancel_err());
            }
            if parse_tx.send(job).await.is_err() {
                break;
            }
        }
        Ok::<(), anyhow::Error>(())
    });

    let tts_cancel = cancel_token.clone();
    let tts_busy = Arc::clone(&tts_busy_ms);
    let tts_idle = Arc::clone(&tts_idle_ms);
    let depth_counter = Arc::clone(&encode_queue_depth);
    let max_depth_tts = Arc::clone(&max_depth);
    let tts_worker = tokio::spawn(async move {
        loop {
            if cancelled(&tts_cancel) {
                return Err(cancel_err());
            }

            let idle_start = Instant::now();
            let job = parse_rx.recv().await;
            tts_idle.fetch_add(
                idle_start.elapsed().as_millis() as u64,
                Ordering::Relaxed,
            );

            let Some(job) = job else {
                break;
            };

            if cancelled(&tts_cancel) {
                return Err(cancel_err());
            }

            let synthesize = Arc::clone(&synthesize);
            let index = job.index;
            let text = job.text;
            let busy_start = Instant::now();
            let result = tokio::task::spawn_blocking(move || synthesize(index, text))
                .await
                .map_err(|e| anyhow::anyhow!("TTS worker join error: {:?}", e))?;
            tts_busy.fetch_add(busy_start.elapsed().as_millis() as u64, Ordering::Relaxed);

            let (pcm, alignments, text) = result?;
            let duration_sec =
                crate::tts::word_timing::pcm_duration_seconds(pcm.len(), SAMPLE_RATE);

            if synth_tx
                .send(SynthesizedJob {
                    index,
                    text,
                    pcm,
                    alignments,
                    duration_sec,
                })
                .await
                .is_err()
            {
                break;
            }

            let depth = depth_counter.fetch_add(1, Ordering::Relaxed) + 1;
            max_depth_tts.fetch_max(depth, Ordering::Relaxed);
        }
        Ok::<(), anyhow::Error>(())
    });

    let encode_cancel = cancel_token.clone();
    let encode_busy = Arc::clone(&encode_busy_ms);
    let depth_counter_enc = Arc::clone(&encode_queue_depth);
    let completed_counter = Arc::clone(&completed);
    let encode_worker = tokio::spawn(async move {
        loop {
            if cancelled(&encode_cancel) {
                return Err(cancel_err());
            }

            let Some(job) = synth_rx.recv().await else {
                break;
            };
            let _ = depth_counter_enc.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |d| {
                Some(d.saturating_sub(1))
            });

            if cancelled(&encode_cancel) {
                return Err(cancel_err());
            }

            let encode = Arc::clone(&encode);
            let pcm_for_encode = job.pcm;
            let busy_start = Instant::now();
            let (pcm, mp3) = tokio::task::spawn_blocking(move || encode(pcm_for_encode))
                .await
                .map_err(|e| anyhow::anyhow!("Encode worker join error: {:?}", e))??;
            encode_busy.fetch_add(busy_start.elapsed().as_millis() as u64, Ordering::Relaxed);

            if out_tx
                .send(EncodedJob {
                    index: job.index,
                    text: job.text,
                    pcm,
                    alignments: job.alignments,
                    duration_sec: job.duration_sec,
                    mp3,
                })
                .await
                .is_err()
            {
                break;
            }
            completed_counter.fetch_add(1, Ordering::Relaxed);
        }
        Ok::<(), anyhow::Error>(())
    });

    let feeder_result = feeder.await;
    let tts_result = tts_worker.await;
    let encode_result = encode_worker.await;

    if cancelled(&cancel_token) {
        return Err(cancel_err());
    }

    for result in [feeder_result, tts_result, encode_result] {
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(e) if e.is_cancelled() => {}
            Err(e) => {
                return Err(anyhow::anyhow!("Pipeline worker join error: {:?}", e));
            }
        }
    }

    Ok(PipelineStats {
        sentences_completed: completed.load(Ordering::Relaxed),
        tts_busy_ms: tts_busy_ms.load(Ordering::Relaxed),
        tts_idle_ms: tts_idle_ms.load(Ordering::Relaxed),
        encode_busy_ms: encode_busy_ms.load(Ordering::Relaxed),
        max_tts_to_encode_depth: max_depth.load(Ordering::Relaxed),
    })
}

/// Convenience helper used by unit tests: drain all outputs then join.
pub async fn run_sentence_pipeline_collect<S, E>(
    jobs: Vec<ParsedJob>,
    config: PipelineConfig,
    cancel_token: Option<Arc<AtomicBool>>,
    synthesize: S,
    encode: E,
) -> anyhow::Result<(Vec<EncodedJob>, PipelineStats)>
where
    S: Fn(usize, String) -> anyhow::Result<(Vec<f32>, Vec<WordAlignment>, String)>
        + Send
        + Sync
        + 'static,
    E: Fn(Vec<f32>) -> anyhow::Result<(Vec<f32>, Vec<u8>)> + Send + Sync + 'static,
{
    let mut handle = start_sentence_pipeline(jobs, config, cancel_token.clone(), synthesize, encode);
    let mut outputs = Vec::new();
    while let Some(job) = handle.output_rx.recv().await {
        if cancelled(&cancel_token) {
            handle.abort();
            let _ = handle.join().await;
            return Err(cancel_err());
        }
        outputs.push(job);
    }
    let stats = handle.join().await?;
    if cancelled(&cancel_token) {
        return Err(cancel_err());
    }
    Ok((outputs, stats))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn silent_pcm(ms: u64) -> Vec<f32> {
        let samples = ((SAMPLE_RATE as u64 * ms) / 1000) as usize;
        vec![0.0; samples.max(1)]
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn preserves_sentence_order_with_variable_tts_latency() {
        let jobs: Vec<ParsedJob> = (0..6)
            .map(|i| ParsedJob {
                index: i,
                text: format!("sentence {i}"),
            })
            .collect();

        let (outputs, stats) = run_sentence_pipeline_collect(
            jobs,
            PipelineConfig {
                parse_to_tts_capacity: 4,
                tts_to_encode_capacity: 2,
            },
            None,
            |idx, text| {
                let delay_ms = 30u64.saturating_sub((idx as u64) * 4);
                std::thread::sleep(Duration::from_millis(delay_ms));
                Ok((silent_pcm(10), Vec::new(), text))
            },
            |pcm| {
                std::thread::sleep(Duration::from_millis(5));
                Ok((pcm, b"mp3".to_vec()))
            },
        )
        .await
        .expect("pipeline should succeed");

        assert_eq!(stats.sentences_completed, 6);
        let order: Vec<_> = outputs.iter().map(|o| o.index).collect();
        assert_eq!(order, vec![0, 1, 2, 3, 4, 5]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn overlaps_encode_with_next_tts() {
        let jobs: Vec<ParsedJob> = (0..4)
            .map(|i| ParsedJob {
                index: i,
                text: format!("s{i}"),
            })
            .collect();

        let tts_ms = 40u64;
        let enc_ms = 40u64;
        let wall_start = Instant::now();

        let (_outputs, stats) = run_sentence_pipeline_collect(
            jobs,
            PipelineConfig {
                parse_to_tts_capacity: 4,
                tts_to_encode_capacity: 2,
            },
            None,
            move |_idx, text| {
                std::thread::sleep(Duration::from_millis(tts_ms));
                Ok((silent_pcm(5), Vec::new(), text))
            },
            move |pcm| {
                std::thread::sleep(Duration::from_millis(enc_ms));
                Ok((pcm, vec![1, 2, 3]))
            },
        )
        .await
        .expect("pipeline should succeed");

        let wall_ms = wall_start.elapsed().as_millis() as u64;
        let serial_ms = 4 * (tts_ms + enc_ms);

        assert!(
            wall_ms < serial_ms.saturating_sub(30),
            "expected overlap: wall={wall_ms}ms serial={serial_ms}ms stats={stats:?}"
        );
        assert!(
            stats.encode_busy_ms >= enc_ms * 3,
            "encode should have run: {stats:?}"
        );
        assert!(
            stats.tts_busy_ms >= tts_ms * 3,
            "tts should have run: {stats:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn respects_cancel_token() {
        let jobs: Vec<ParsedJob> = (0..20)
            .map(|i| ParsedJob {
                index: i,
                text: format!("s{i}"),
            })
            .collect();

        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_flag = Arc::clone(&cancel);

        let handle = tokio::spawn(async move {
            run_sentence_pipeline_collect(
                jobs,
                PipelineConfig::default(),
                Some(cancel_flag),
                |_idx, text| {
                    std::thread::sleep(Duration::from_millis(25));
                    Ok((silent_pcm(5), Vec::new(), text))
                },
                |pcm| Ok((pcm, b"x".to_vec())),
            )
            .await
        });

        tokio::time::sleep(Duration::from_millis(60)).await;
        cancel.store(true, Ordering::Relaxed);

        let result = handle.await.expect("join");
        assert!(result.is_err(), "expected cancel error, got {result:?}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn bounds_tts_to_encode_queue_depth() {
        let jobs: Vec<ParsedJob> = (0..8)
            .map(|i| ParsedJob {
                index: i,
                text: format!("s{i}"),
            })
            .collect();

        let cap = 2usize;
        let (_outputs, stats) = run_sentence_pipeline_collect(
            jobs,
            PipelineConfig {
                parse_to_tts_capacity: 8,
                tts_to_encode_capacity: cap,
            },
            None,
            |_idx, text| {
                std::thread::sleep(Duration::from_millis(5));
                Ok((silent_pcm(5), Vec::new(), text))
            },
            |pcm| {
                std::thread::sleep(Duration::from_millis(40));
                Ok((pcm, b"x".to_vec()))
            },
        )
        .await
        .expect("pipeline should succeed");

        assert!(
            stats.max_tts_to_encode_depth <= cap,
            "queue depth {} exceeded capacity {cap}",
            stats.max_tts_to_encode_depth
        );
        assert_eq!(stats.sentences_completed, 8);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn empty_job_list_is_noop() {
        let (outputs, stats) = run_sentence_pipeline_collect(
            Vec::new(),
            PipelineConfig::default(),
            None,
            |_idx, text| Ok((Vec::new(), Vec::new(), text)),
            |pcm| Ok((pcm, Vec::new())),
        )
        .await
        .expect("empty pipeline");
        assert!(outputs.is_empty());
        assert_eq!(stats.sentences_completed, 0);
    }
}
