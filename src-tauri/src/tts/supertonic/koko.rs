use crate::tts::supertonic::core::{
    is_valid_lang, load_cfgs, load_voice_style, Style, AVAILABLE_LANGS,
};
use crate::tts::supertonic::ort_koko::OrtKoko;
use anyhow::Context;
use serde::Deserialize;
use std::collections::HashMap;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct WordAlignment {
    pub word: String,
    pub start_sec: f32,
    pub end_sec: f32,
}

#[derive(Clone)]
pub struct TTSKokoParallel {
    #[allow(dead_code)]
    model_path: String,
    #[allow(dead_code)]
    voices_root: PathBuf,
    models: Vec<Arc<Mutex<OrtKoko>>>,
    voice_files: HashMap<String, PathBuf>,
    init_config: InitConfig,
}

#[derive(Clone)]
pub struct InitConfig {
    pub sample_rate: u32,
    pub total_step: usize,
}

impl Default for InitConfig {
    fn default() -> Self {
        Self {
            sample_rate: 44_100,
            total_step: 10,
        }
    }
}

fn normalize_lang(lan: &str) -> String {
    let l = lan.to_lowercase();
    let code = l.split(['-', '_']).next().unwrap_or(&l);
    if AVAILABLE_LANGS.iter().any(|x| *x == code) {
        return code.to_string();
    }
    if is_valid_lang(&l) {
        return l;
    }
    "en".to_string()
}

fn map_speed(speed: f32) -> f32 {
    if !speed.is_finite() || speed <= 0.0 {
        return 1.05;
    }
    speed.clamp(0.25, 4.0)
}

#[derive(Deserialize)]
struct VoiceMapFile {
    #[serde(flatten)]
    aliases: HashMap<String, String>,
}

fn builtin_voice_aliases() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("af_heart".to_string(), "M1".to_string());
    m.insert("af_bella".to_string(), "F1".to_string());
    m.insert("am_adam".to_string(), "M1".to_string());
    m.insert("af_sarah".to_string(), "F1".to_string());
    m
}

fn collect_voice_catalog(voices_root: &Path) -> HashMap<String, PathBuf> {
    let mut files: HashMap<String, PathBuf> = HashMap::new();
    let scan_dir = if voices_root.join("voice_styles").is_dir() {
        voices_root.join("voice_styles")
    } else {
        voices_root.to_path_buf()
    };

    if let Ok(rd) = std::fs::read_dir(&scan_dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if stem == "voice_map" {
                        continue;
                    }
                    files.insert(stem.to_string(), path.clone());
                }
            }
        }
    }

    let map_path = voices_root.join("voice_map.json");
    if map_path.exists() {
        if let Ok(txt) = std::fs::read_to_string(&map_path) {
            if let Ok(vm) = serde_json::from_str::<VoiceMapFile>(&txt) {
                for (alias, stem) in vm.aliases {
                    if let Some(p) = files.get(&stem) {
                        files.insert(alias, p.clone());
                    }
                }
            }
        }
    }

    for (alias, stem) in builtin_voice_aliases() {
        if let Some(p) = files.get(&stem).cloned() {
            files.entry(alias).or_insert(p);
        }
    }

    files
}

fn resolve_voice_path(
    voice_files: &HashMap<String, PathBuf>,
    style_name: &str,
) -> Result<PathBuf, String> {
    if let Some(p) = voice_files.get(style_name) {
        return Ok(p.clone());
    }
    let trimmed = style_name.trim_end_matches(".json");
    if let Some(p) = voice_files.get(trimmed) {
        return Ok(p.clone());
    }
    Err(format!(
        "Unknown voice {:?}. Available: {:?}",
        style_name,
        voice_files.keys().collect::<Vec<_>>()
    ))
}

impl TTSKokoParallel {
    pub async fn new_with_instances(
        onnx_dir: &str,
        voices_root: &str,
        num_instances: usize,
    ) -> Self {
        Self::from_config_with_instances(onnx_dir, voices_root, InitConfig::default(), num_instances)
            .await
    }

    pub async fn from_config_with_instances(
        onnx_dir: &str,
        voices_root: &str,
        cfg: InitConfig,
        num_instances: usize,
    ) -> Self {
        let onnx_dir = onnx_dir.to_string();
        let voices_root = voices_root.to_string();
        let cfg = cfg.clone();
        tokio::task::spawn_blocking(move || Self::init_sync(&onnx_dir, &voices_root, cfg, num_instances))
            .await
            .expect("TTS init task panicked")
    }

    fn init_sync(onnx_dir: &str, voices_root: &str, mut cfg: InitConfig, num_instances: usize) -> Self {
        let onnx_path = Path::new(onnx_dir);
        if !onnx_path.is_dir() || !onnx_path.join("tts.json").exists() {
            panic!(
                "Supertonic ONNX directory not found or invalid (expected tts.json): {}",
                onnx_dir
            );
        }

        let voices_path = Path::new(voices_root);
        if !voices_path.is_dir() {
            panic!(
                "Supertonic voice assets directory not found: {}",
                voices_root
            );
        }

        let cfgs = load_cfgs(onnx_path).expect("load tts.json");
        cfg.sample_rate = cfgs.ae.sample_rate.max(1) as u32;

        let mut models = Vec::with_capacity(num_instances.max(1));
        for i in 0..num_instances.max(1) {
            log::info!(
                "Creating Supertonic TTS instance [{:02x}] ({}/{})",
                i,
                i + 1,
                num_instances.max(1)
            );
            let m = OrtKoko::new(onnx_dir.to_string()).unwrap_or_else(|e| {
                panic!("Failed to create Supertonic OrtKoko instance {}: {}", i, e);
            });
            models.push(Arc::new(Mutex::new(m)));
        }

        let voice_files = collect_voice_catalog(voices_path);
        if voice_files.is_empty() {
            panic!(
                "No voice style JSON files found under {} (expected voice_styles/*.json or *.json).",
                voices_path.display()
            );
        }

        Self {
            model_path: onnx_dir.to_string(),
            voices_root: voices_path.to_path_buf(),
            models,
            voice_files,
            init_config: cfg,
        }
    }

    pub fn get_model_instance(&self, worker_id: usize) -> Arc<Mutex<OrtKoko>> {
        let index = worker_id % self.models.len();
        Arc::clone(&self.models[index])
    }

    pub fn tts_raw_audio_with_instance(
        &self,
        text: &str,
        language: &str,
        style_name: &str,
        speed: f32,
        initial_silence: Option<usize>,
        request_id: Option<&str>,
        instance_id: Option<&str>,
        chunk_number: Option<usize>,
        model_instance: Arc<Mutex<OrtKoko>>,
    ) -> Result<Vec<f32>, Box<dyn Error>> {
        let _ = (request_id, instance_id, chunk_number);

        let lang = normalize_lang(language);
        let path = resolve_voice_path(&self.voice_files, style_name)
            .map_err(|e| -> Box<dyn Error> { e.into() })?;
        let style: Style = load_voice_style(&[path.to_string_lossy().into_owned()], false)?;

        let mut guard = model_instance
            .lock()
            .map_err(|e| -> Box<dyn Error> { format!("model mutex poisoned: {}", e).into() })?;
        let total_step = self.init_config.total_step.max(1);
        let normalized_text = text.to_lowercase();
        let (mut audio, _) = guard
            .tts
            .call(
                &normalized_text,
                &lang,
                &style,
                total_step,
                map_speed(speed),
                0.3,
            )
            .with_context(|| "Supertonic synthesis failed")?;
        let sr = guard.tts.sample_rate.max(1) as u32;
        drop(guard);

        if let Some(ms) = initial_silence {
            if ms > 0 {
                let clamped_ms = ms.min(60_000) as f32;
                let silence_len = ((clamped_ms / 1000.0) * sr as f32).round() as usize;
                let mut pad = vec![0.0f32; silence_len];
                pad.append(&mut audio);
                audio = pad;
            }
        }

        Ok(audio)
    }

    /// Synthesize multiple strings in one session using ONNX batching (aligned chunk rounds).
    ///
    /// Returns one waveform per input string (same order as `texts`). Empty `texts` yields an empty vec.
    pub fn tts_raw_audio_batch_with_instance(
        &self,
        texts: &[String],
        language: &str,
        style_name: &str,
        speed: f32,
        initial_silence: Option<usize>,
        request_id: Option<&str>,
        instance_id: Option<&str>,
        chunk_number: Option<usize>,
        model_instance: Arc<Mutex<OrtKoko>>,
    ) -> Result<Vec<Vec<f32>>, Box<dyn Error>> {
        let _ = (request_id, instance_id, chunk_number);

        if texts.is_empty() {
            return Ok(Vec::new());
        }

        let lang = normalize_lang(language);
        let path = resolve_voice_path(&self.voice_files, style_name)
            .map_err(|e| -> Box<dyn Error> { e.into() })?;
        let style: Style = load_voice_style(&[path.to_string_lossy().into_owned()], false)?;

        let mut guard = model_instance
            .lock()
            .map_err(|e| -> Box<dyn Error> { format!("model mutex poisoned: {}", e).into() })?;
        let total_step = self.init_config.total_step.max(1);
        let normalized: Vec<String> = texts.iter().map(|t| t.to_lowercase()).collect();
        let mut batch = guard
            .tts
            .call_batch(
                &normalized,
                &lang,
                &style,
                total_step,
                map_speed(speed),
                0.3,
            )
            .with_context(|| "Supertonic batch synthesis failed")?;
        let sr = guard.tts.sample_rate.max(1) as u32;
        drop(guard);

        let mut results: Vec<Vec<f32>> = batch.into_iter().map(|(a, _)| a).collect();

        if let Some(ms) = initial_silence {
            if ms > 0 {
                let clamped_ms = ms.min(60_000) as f32;
                let silence_len = ((clamped_ms / 1000.0) * sr as f32).round() as usize;
                for audio in &mut results {
                    let mut pad = vec![0.0f32; silence_len];
                    pad.append(audio);
                    *audio = pad;
                }
            }
        }

        Ok(results)
    }
}
