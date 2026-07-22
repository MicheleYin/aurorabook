use anyhow::{anyhow, bail, Context, Result};
use ndarray::{Array, Array3, Axis};
use ort::{ep, session::Session, value::Tensor};
use rand_distr::{Distribution, Normal};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

// Keep in sync with frontend language constants.
pub const AVAILABLE_LANGS: &[&str] = &["en", "ko", "es", "pt", "fr"];

pub fn is_valid_lang(lang: &str) -> bool {
    AVAILABLE_LANGS.contains(&lang)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub ae: AEConfig,
    pub ttl: TTLConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AEConfig {
    pub sample_rate: i32,
    pub base_chunk_size: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TTLConfig {
    pub chunk_compress_factor: i32,
    pub latent_dim: i32,
}

pub fn load_cfgs<P: AsRef<Path>>(onnx_dir: P) -> Result<Config> {
    let cfg_path = onnx_dir.as_ref().join("tts.json");
    let file = File::open(cfg_path)?;
    let reader = BufReader::new(file);
    let cfgs: Config = serde_json::from_reader(reader)?;
    Ok(cfgs)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceStyleData {
    pub style_ttl: StyleComponent,
    pub style_dp: StyleComponent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleComponent {
    pub data: Vec<Vec<Vec<f32>>>,
    pub dims: Vec<usize>,
    #[serde(rename = "type")]
    pub dtype: String,
}

pub struct UnicodeProcessor {
    indexer: Vec<i64>,
}

impl UnicodeProcessor {
    pub fn new<P: AsRef<Path>>(unicode_indexer_json_path: P) -> Result<Self> {
        let file = File::open(unicode_indexer_json_path)?;
        let reader = BufReader::new(file);
        let indexer: Vec<i64> = serde_json::from_reader(reader)?;
        Ok(UnicodeProcessor { indexer })
    }

    pub fn call(
        &self,
        text_list: &[String],
        lang_list: &[String],
    ) -> Result<(Vec<Vec<i64>>, Array3<f32>)> {
        let mut processed_texts: Vec<String> = Vec::new();
        for (text, lang) in text_list.iter().zip(lang_list.iter()) {
            processed_texts.push(preprocess_text(text, lang)?);
        }

        let text_ids_lengths: Vec<usize> =
            processed_texts.iter().map(|t| t.chars().count()).collect();
        let max_len = *text_ids_lengths.iter().max().unwrap_or(&0);

        let mut text_ids = Vec::new();
        for text in &processed_texts {
            let mut row = vec![0i64; max_len];
            let unicode_vals = text_to_unicode_values(text);
            for (j, &val) in unicode_vals.iter().enumerate() {
                if val < self.indexer.len() {
                    row[j] = self.indexer[val];
                } else {
                    row[j] = -1;
                }
            }
            text_ids.push(row);
        }

        let text_mask = get_text_mask(&text_ids_lengths);
        Ok((text_ids, text_mask))
    }
}

pub fn preprocess_text(text: &str, lang: &str) -> Result<String> {
    let mut text: String = text.nfkd().collect();
    let emoji_pattern = Regex::new(r"[\x{1F600}-\x{1F64F}\x{1F300}-\x{1F5FF}\x{1F680}-\x{1F6FF}\x{1F700}-\x{1F77F}\x{1F780}-\x{1F7FF}\x{1F800}-\x{1F8FF}\x{1F900}-\x{1F9FF}\x{1FA00}-\x{1FA6F}\x{1FA70}-\x{1FAFF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{1F1E6}-\x{1F1FF}]+").unwrap();
    text = emoji_pattern.replace_all(&text, "").to_string();

    let replacements = [
        ("–", "-"),
        ("‑", "-"),
        ("—", "-"),
        ("_", " "),
        ("\u{201C}", "\""),
        ("\u{201D}", "\""),
        ("\u{2018}", "'"),
        ("\u{2019}", "'"),
        ("´", "'"),
        ("`", "'"),
        ("[", " "),
        ("]", " "),
        ("|", " "),
        ("/", " "),
        ("#", " "),
        ("→", " "),
        ("←", " "),
    ];
    for (from, to) in &replacements {
        text = text.replace(from, to);
    }

    for symbol in ["♥", "☆", "♡", "©", "\\"] {
        text = text.replace(symbol, "");
    }

    for (from, to) in [
        ("@", " at "),
        ("e.g.,", "for example, "),
        ("i.e.,", "that is, "),
    ] {
        text = text.replace(from, to);
    }

    text = Regex::new(r" ,")
        .unwrap()
        .replace_all(&text, ",")
        .to_string();
    text = Regex::new(r" \.")
        .unwrap()
        .replace_all(&text, ".")
        .to_string();
    text = Regex::new(r" !")
        .unwrap()
        .replace_all(&text, "!")
        .to_string();
    text = Regex::new(r" \?")
        .unwrap()
        .replace_all(&text, "?")
        .to_string();
    text = Regex::new(r" ;")
        .unwrap()
        .replace_all(&text, ";")
        .to_string();
    text = Regex::new(r" :")
        .unwrap()
        .replace_all(&text, ":")
        .to_string();
    text = Regex::new(r" '")
        .unwrap()
        .replace_all(&text, "'")
        .to_string();

    while text.contains("\"\"") {
        text = text.replace("\"\"", "\"");
    }
    while text.contains("''") {
        text = text.replace("''", "'");
    }
    while text.contains("``") {
        text = text.replace("``", "`");
    }

    text = Regex::new(r"\s+")
        .unwrap()
        .replace_all(&text, " ")
        .to_string();
    text = text.trim().to_string();

    if !text.is_empty() {
        let ends_with_punct =
            Regex::new(r#"[.!?;:,'"\u{201C}\u{201D}\u{2018}\u{2019})\]}…。」』】〉》›»]$"#)
                .unwrap();
        if !ends_with_punct.is_match(&text) {
            text.push('.');
        }
    }

    if !is_valid_lang(lang) {
        bail!(
            "Invalid language: {}. Available: {:?}",
            lang,
            AVAILABLE_LANGS
        );
    }

    Ok(format!("<{}>{}</{}>", lang, text, lang))
}

fn text_to_unicode_values(text: &str) -> Vec<usize> {
    text.chars().map(|c| c as usize).collect()
}

fn length_to_mask(lengths: &[usize], max_len: Option<usize>) -> Array3<f32> {
    let bsz = lengths.len();
    let max_len = max_len.unwrap_or_else(|| *lengths.iter().max().unwrap_or(&0));

    let mut mask = Array3::<f32>::zeros((bsz, 1, max_len));
    for (i, &len) in lengths.iter().enumerate() {
        for j in 0..len.min(max_len) {
            mask[[i, 0, j]] = 1.0;
        }
    }
    mask
}

fn get_text_mask(text_ids_lengths: &[usize]) -> Array3<f32> {
    let max_len = *text_ids_lengths.iter().max().unwrap_or(&0);
    length_to_mask(text_ids_lengths, Some(max_len))
}

fn sample_noisy_latent(
    duration: &[f32],
    sample_rate: i32,
    base_chunk_size: i32,
    chunk_compress: i32,
    latent_dim: i32,
) -> (Array3<f32>, Array3<f32>) {
    let bsz = duration.len();
    let max_dur = duration.iter().fold(0.0f32, |a, &b| a.max(b));

    let wav_len_max = (max_dur * sample_rate as f32) as usize;
    let wav_lengths: Vec<usize> = duration
        .iter()
        .map(|&d| (d * sample_rate as f32) as usize)
        .collect();

    let chunk_size = (base_chunk_size * chunk_compress) as usize;
    let latent_len = (wav_len_max + chunk_size - 1) / chunk_size;
    let latent_dim_val = (latent_dim * chunk_compress) as usize;

    let mut noisy_latent = Array3::<f32>::zeros((bsz, latent_dim_val, latent_len));
    let normal = Normal::new(0.0, 1.0).unwrap();
    let mut rng = rand::thread_rng();

    for b in 0..bsz {
        for d in 0..latent_dim_val {
            for t in 0..latent_len {
                noisy_latent[[b, d, t]] = normal.sample(&mut rng);
            }
        }
    }

    let latent_lengths: Vec<usize> = wav_lengths
        .iter()
        .map(|&len| (len + chunk_size - 1) / chunk_size)
        .collect();
    let latent_mask = length_to_mask(&latent_lengths, Some(latent_len));

    for b in 0..bsz {
        for d in 0..latent_dim_val {
            for t in 0..latent_len {
                noisy_latent[[b, d, t]] *= latent_mask[[b, 0, t]];
            }
        }
    }

    (noisy_latent, latent_mask)
}

/// Upper bound on ONNX batch dimension per forward pass (avoids huge padded tensors).
const MAX_ONNX_BATCH: usize = 32;

const MAX_CHUNK_LENGTH: usize = 500;
const ABBREVIATIONS: &[&str] = &[
    "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.", "St.", "Ave.", "Rd.", "Blvd.", "Dept.",
    "Inc.", "Ltd.", "Co.", "Corp.", "etc.", "vs.", "i.e.", "e.g.", "Ph.D.",
];

fn chunk_text(text: &str, max_len: Option<usize>) -> Vec<String> {
    let max_len = max_len.unwrap_or(MAX_CHUNK_LENGTH);
    let text = text.trim();
    if text.is_empty() {
        return vec![String::new()];
    }

    let para_re = Regex::new(r"\n\s*\n").unwrap();
    let paragraphs: Vec<&str> = para_re.split(text).collect();
    let mut chunks = Vec::new();

    for para in paragraphs {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }

        if para.len() <= max_len {
            chunks.push(para.to_string());
            continue;
        }

        let sentences = split_sentences(para);
        let mut current = String::new();
        let mut current_len = 0;

        for sentence in sentences {
            let sentence = sentence.trim();
            if sentence.is_empty() {
                continue;
            }
            let sentence_len = sentence.len();
            if sentence_len > max_len {
                if !current.is_empty() {
                    chunks.push(current.trim().to_string());
                    current.clear();
                    current_len = 0;
                }
                let parts: Vec<&str> = sentence.split(',').collect();
                for part in parts {
                    let part = part.trim();
                    if part.is_empty() {
                        continue;
                    }

                    let part_len = part.len();
                    if part_len > max_len {
                        let words: Vec<&str> = part.split_whitespace().collect();
                        let mut word_chunk = String::new();
                        let mut word_chunk_len = 0;
                        for word in words {
                            let word_len = word.len();
                            if word_chunk_len + word_len + 1 > max_len && !word_chunk.is_empty() {
                                chunks.push(word_chunk.trim().to_string());
                                word_chunk.clear();
                                word_chunk_len = 0;
                            }
                            if !word_chunk.is_empty() {
                                word_chunk.push(' ');
                                word_chunk_len += 1;
                            }
                            word_chunk.push_str(word);
                            word_chunk_len += word_len;
                        }
                        if !word_chunk.is_empty() {
                            chunks.push(word_chunk.trim().to_string());
                        }
                    } else {
                        if current_len + part_len + 1 > max_len && !current.is_empty() {
                            chunks.push(current.trim().to_string());
                            current.clear();
                            current_len = 0;
                        }
                        if !current.is_empty() {
                            current.push_str(", ");
                            current_len += 2;
                        }
                        current.push_str(part);
                        current_len += part_len;
                    }
                }
                continue;
            }

            if current_len + sentence_len + 1 > max_len && !current.is_empty() {
                chunks.push(current.trim().to_string());
                current.clear();
                current_len = 0;
            }
            if !current.is_empty() {
                current.push(' ');
                current_len += 1;
            }
            current.push_str(sentence);
            current_len += sentence_len;
        }

        if !current.is_empty() {
            chunks.push(current.trim().to_string());
        }
    }

    if chunks.is_empty() {
        vec![String::new()]
    } else {
        chunks
    }
}

fn split_sentences(text: &str) -> Vec<String> {
    let re = Regex::new(r"([.!?])\s+").unwrap();
    let matches: Vec<_> = re.find_iter(text).collect();
    if matches.is_empty() {
        return vec![text.to_string()];
    }

    let mut sentences = Vec::new();
    let mut last_end = 0;
    for m in matches {
        let before_punc = &text[last_end..m.start()];
        let mut is_abbrev = false;
        for abbrev in ABBREVIATIONS {
            let combined = format!("{}{}", before_punc.trim(), &text[m.start()..m.start() + 1]);
            if combined.ends_with(abbrev) {
                is_abbrev = true;
                break;
            }
        }
        if !is_abbrev {
            sentences.push(text[last_end..m.end()].to_string());
            last_end = m.end();
        }
    }
    if last_end < text.len() {
        sentences.push(text[last_end..].to_string());
    }
    if sentences.is_empty() {
        vec![text.to_string()]
    } else {
        sentences
    }
}

pub struct Style {
    pub ttl: Array3<f32>,
    pub dp: Array3<f32>,
}

fn expand_style_for_batch(style: &Style, batch_size: usize) -> Result<Style> {
    if batch_size == 0 {
        bail!("Batch size must be greater than 0");
    }

    let (style_bsz, ttl_dim1, ttl_dim2) = style.ttl.dim();
    let (dp_bsz, dp_dim1, dp_dim2) = style.dp.dim();
    if style_bsz != dp_bsz {
        bail!(
            "Style TTL/DP batch size mismatch: ttl={}, dp={}",
            style_bsz,
            dp_bsz
        );
    }

    if style_bsz == batch_size {
        return Ok(Style {
            ttl: style.ttl.clone(),
            dp: style.dp.clone(),
        });
    }

    if style_bsz != 1 {
        bail!(
            "Cannot expand style batch of {} to {}. Expected style batch size 1 or exact match.",
            style_bsz,
            batch_size
        );
    }

    let ttl_single = style.ttl.index_axis(Axis(0), 0).to_owned();
    let dp_single = style.dp.index_axis(Axis(0), 0).to_owned();
    let mut ttl_batched = Array3::<f32>::zeros((batch_size, ttl_dim1, ttl_dim2));
    let mut dp_batched = Array3::<f32>::zeros((batch_size, dp_dim1, dp_dim2));
    for idx in 0..batch_size {
        ttl_batched.index_axis_mut(Axis(0), idx).assign(&ttl_single);
        dp_batched.index_axis_mut(Axis(0), idx).assign(&dp_single);
    }

    Ok(Style {
        ttl: ttl_batched,
        dp: dp_batched,
    })
}

pub struct TextToSpeech {
    cfgs: Config,
    text_processor: UnicodeProcessor,
    dp_ort: Session,
    text_enc_ort: Session,
    vector_est_ort: Session,
    vocoder_ort: Session,
    pub sample_rate: i32,
}

impl TextToSpeech {
    pub fn new(
        cfgs: Config,
        text_processor: UnicodeProcessor,
        dp_ort: Session,
        text_enc_ort: Session,
        vector_est_ort: Session,
        vocoder_ort: Session,
    ) -> Self {
        let sample_rate = cfgs.ae.sample_rate;
        Self {
            cfgs,
            text_processor,
            dp_ort,
            text_enc_ort,
            vector_est_ort,
            vocoder_ort,
            sample_rate,
        }
    }

    fn infer(
        &mut self,
        text_list: &[String],
        lang_list: &[String],
        style: &Style,
        total_step: usize,
        speed: f32,
    ) -> Result<(Vec<Vec<f32>>, Vec<f32>)> {
        let bsz = text_list.len();
        let (text_ids, text_mask) = self.text_processor.call(text_list, lang_list)?;
        let text_ids_shape = (bsz, text_ids[0].len());
        let mut flat = Vec::new();
        for row in &text_ids {
            flat.extend_from_slice(row);
        }
        let text_ids_array = Array::from_shape_vec(text_ids_shape, flat)?;

        let text_ids_value = Tensor::from_array(text_ids_array)?;
        let text_mask_value = Tensor::from_array(text_mask.clone())?;
        let style_dp_value = Tensor::from_array(style.dp.clone())?;

        let dp_outputs = self.dp_ort.run(ort::inputs! {
            "text_ids" => &text_ids_value,
            "style_dp" => &style_dp_value,
            "text_mask" => &text_mask_value
        })?;
        let (_, duration_data) = dp_outputs["duration"].try_extract_tensor::<f32>()?;
        let mut duration: Vec<f32> = duration_data.to_vec();
        for dur in &mut duration {
            *dur /= speed;
        }

        let style_ttl_value = Tensor::from_array(style.ttl.clone())?;
        let text_enc_outputs = self.text_enc_ort.run(ort::inputs! {
            "text_ids" => &text_ids_value,
            "style_ttl" => &style_ttl_value,
            "text_mask" => &text_mask_value
        })?;
        let (text_emb_shape, text_emb_data) =
            text_enc_outputs["text_emb"].try_extract_tensor::<f32>()?;
        let text_emb = Array3::from_shape_vec(
            (
                text_emb_shape[0] as usize,
                text_emb_shape[1] as usize,
                text_emb_shape[2] as usize,
            ),
            text_emb_data.to_vec(),
        )?;

        let (mut xt, latent_mask) = sample_noisy_latent(
            &duration,
            self.sample_rate,
            self.cfgs.ae.base_chunk_size,
            self.cfgs.ttl.chunk_compress_factor,
            self.cfgs.ttl.latent_dim,
        );
        let total_step_array = Array::from_elem(bsz, total_step as f32);

        for step in 0..total_step {
            let current_step_array = Array::from_elem(bsz, step as f32);
            let xt_value = Tensor::from_array(xt.clone())?;
            let text_emb_value = Tensor::from_array(text_emb.clone())?;
            let latent_mask_value = Tensor::from_array(latent_mask.clone())?;
            let text_mask_value2 = Tensor::from_array(text_mask.clone())?;
            let current_step_value = Tensor::from_array(current_step_array)?;
            let total_step_value = Tensor::from_array(total_step_array.clone())?;

            let vector_est_outputs = self.vector_est_ort.run(ort::inputs! {
                "noisy_latent" => &xt_value,
                "text_emb" => &text_emb_value,
                "style_ttl" => &style_ttl_value,
                "latent_mask" => &latent_mask_value,
                "text_mask" => &text_mask_value2,
                "current_step" => &current_step_value,
                "total_step" => &total_step_value
            })?;
            let (denoised_shape, denoised_data) =
                vector_est_outputs["denoised_latent"].try_extract_tensor::<f32>()?;
            xt = Array3::from_shape_vec(
                (
                    denoised_shape[0] as usize,
                    denoised_shape[1] as usize,
                    denoised_shape[2] as usize,
                ),
                denoised_data.to_vec(),
            )?;
        }

        let final_latent_value = Tensor::from_array(xt)?;
        let vocoder_outputs = self.vocoder_ort.run(ort::inputs! {
            "latent" => &final_latent_value
        })?;
        let (wav_shape, wav_data) = vocoder_outputs["wav_tts"].try_extract_tensor::<f32>()?;
        let wav_shape_usize: Vec<usize> = wav_shape.iter().map(|d| *d as usize).collect();
        let wav_vec = wav_data.to_vec();

        let per_item_waveforms = match wav_shape_usize.as_slice() {
            [time_len] => {
                if bsz != 1 {
                    bail!(
                        "Unexpected 1D wav output shape {:?} for batch size {}",
                        wav_shape_usize,
                        bsz
                    );
                }
                vec![wav_vec[..(*time_len).min(wav_vec.len())].to_vec()]
            }
            [batch, time_len] if *batch == bsz => wav_vec
                .chunks(*time_len)
                .take(bsz)
                .map(|chunk| chunk.to_vec())
                .collect(),
            [time_len, batch] if *batch == bsz => {
                let mut out = vec![vec![0.0f32; *time_len]; bsz];
                for t in 0..*time_len {
                    for b in 0..bsz {
                        let src_idx = t * bsz + b;
                        if src_idx < wav_vec.len() {
                            out[b][t] = wav_vec[src_idx];
                        }
                    }
                }
                out
            }
            [batch, 1, time_len] if *batch == bsz => {
                let stride = *time_len;
                wav_vec
                    .chunks(stride)
                    .take(bsz)
                    .map(|chunk| chunk.to_vec())
                    .collect()
            }
            [batch, time_len, 1] if *batch == bsz => {
                let stride = *time_len;
                wav_vec
                    .chunks(stride)
                    .take(bsz)
                    .map(|chunk| chunk.to_vec())
                    .collect()
            }
            _ => bail!(
                "Unexpected wav output shape {:?} for batch size {}",
                wav_shape_usize,
                bsz
            ),
        };

        if per_item_waveforms.len() != bsz {
            bail!(
                "Decoded waveform count mismatch: got {}, expected {}",
                per_item_waveforms.len(),
                bsz
            );
        }

        Ok((per_item_waveforms, duration))
    }

    pub fn call(
        &mut self,
        text: &str,
        lang: &str,
        style: &Style,
        total_step: usize,
        speed: f32,
        silence_duration: f32,
    ) -> Result<(Vec<f32>, f32)> {
        let max_len = if lang == "ko" { 120 } else { 300 };
        let chunks = chunk_text(text, Some(max_len));
        let mut wav_cat: Vec<f32> = Vec::new();
        let mut dur_cat: f32 = 0.0;

        // One ONNX inference per text chunk (no multi-segment batching).
        for (chunk_idx, chunk_text) in chunks.iter().enumerate() {
            let text_batch = vec![chunk_text.clone()];
            let lang_batch = vec![lang.to_string()];
            let style_one = expand_style_for_batch(style, 1)?;
            let (batch_waveforms, durations) =
                self.infer(&text_batch, &lang_batch, &style_one, total_step, speed)?;
            let wav = batch_waveforms
                .first()
                .ok_or_else(|| anyhow!("infer returned no waveforms"))?;
            let dur = *durations
                .first()
                .ok_or_else(|| anyhow!("infer returned no durations"))?;

            let wav_len = (self.sample_rate as f32 * dur) as usize;
            let wav_chunk = &wav[..wav_len.min(wav.len())];

            if chunk_idx == 0 {
                wav_cat.extend_from_slice(wav_chunk);
                dur_cat = dur;
            } else {
                let silence_len = (silence_duration * self.sample_rate as f32) as usize;
                let silence = vec![0.0f32; silence_len];
                wav_cat.extend_from_slice(&silence);
                wav_cat.extend_from_slice(wav_chunk);
                dur_cat += silence_duration + dur;
            }
        }

        Ok((wav_cat, dur_cat))
    }

    /// Single forward pass(es) for multiple pre-sized utterances (no internal chunking).
    ///
    /// Long inputs should be split by the caller or use [`Self::call_batch`], which applies the
    /// same chunking rules as [`Self::call`]. When more than [`MAX_ONNX_BATCH`] lines are passed,
    /// this method runs multiple forwards while preserving output order.
    pub fn synthesize_batch(
        &mut self,
        text_list: &[String],
        lang_list: &[String],
        style: &Style,
        total_step: usize,
        speed: f32,
    ) -> Result<(Vec<Vec<f32>>, Vec<f32>)> {
        if text_list.len() != lang_list.len() {
            bail!(
                "text_list and lang_list length mismatch: {} vs {}",
                text_list.len(),
                lang_list.len()
            );
        }
        if text_list.is_empty() {
            bail!("synthesize_batch requires at least one text");
        }

        if text_list.len() <= MAX_ONNX_BATCH {
            let style_expanded = expand_style_for_batch(style, text_list.len())?;
            return self.infer(text_list, lang_list, &style_expanded, total_step, speed);
        }

        let mut all_wavs = Vec::with_capacity(text_list.len());
        let mut all_durs = Vec::with_capacity(text_list.len());
        let mut start = 0;
        while start < text_list.len() {
            let end = (start + MAX_ONNX_BATCH).min(text_list.len());
            let style_expanded = expand_style_for_batch(style, end - start)?;
            let (w, d) = self.infer(
                &text_list[start..end],
                &lang_list[start..end],
                &style_expanded,
                total_step,
                speed,
            )?;
            all_wavs.extend(w);
            all_durs.extend(d);
            start = end;
        }
        Ok((all_wavs, all_durs))
    }

    /// Like [`Self::call`] but for many strings: chunks each line, then batches ONNX inference
    /// across texts for each chunk round (and sub-batches when needed).
    pub fn call_batch(
        &mut self,
        texts: &[String],
        lang: &str,
        style: &Style,
        total_step: usize,
        speed: f32,
        silence_duration: f32,
    ) -> Result<Vec<(Vec<f32>, f32)>> {
        let n = texts.len();
        if n == 0 {
            return Ok(Vec::new());
        }

        let max_len = if lang == "ko" { 120 } else { 300 };
        let per_text_chunks: Vec<Vec<String>> =
            texts.iter().map(|t| chunk_text(t, Some(max_len))).collect();

        let max_rounds = per_text_chunks.iter().map(|c| c.len()).max().unwrap_or(0);

        let mut wav_acc: Vec<Vec<f32>> = vec![Vec::new(); n];
        let mut dur_acc: Vec<f32> = vec![0.0; n];

        for chunk_round in 0..max_rounds {
            let mut text_batch = Vec::new();
            let mut lang_batch = Vec::new();
            let mut row_idx: Vec<usize> = Vec::new();

            for i in 0..n {
                if chunk_round < per_text_chunks[i].len() {
                    text_batch.push(per_text_chunks[i][chunk_round].clone());
                    lang_batch.push(lang.to_string());
                    row_idx.push(i);
                }
            }

            if text_batch.is_empty() {
                continue;
            }

            let mut wave_offset = 0;
            while wave_offset < text_batch.len() {
                let end = (wave_offset + MAX_ONNX_BATCH).min(text_batch.len());
                let sub_text = &text_batch[wave_offset..end];
                let sub_lang = &lang_batch[wave_offset..end];
                let sub_row = &row_idx[wave_offset..end];

                let style_b = expand_style_for_batch(style, sub_text.len())?;
                let (batch_waveforms, durations) =
                    self.infer(sub_text, sub_lang, &style_b, total_step, speed)?;

                for (j, &text_i) in sub_row.iter().enumerate() {
                    let wav = &batch_waveforms[j];
                    let dur = durations[j];

                    let wav_len = (self.sample_rate as f32 * dur) as usize;
                    let wav_chunk = &wav[..wav_len.min(wav.len())];

                    if !wav_acc[text_i].is_empty() {
                        let silence_len = (silence_duration * self.sample_rate as f32) as usize;
                        wav_acc[text_i].extend_from_slice(&vec![0.0f32; silence_len]);
                        dur_acc[text_i] += silence_duration;
                    }

                    wav_acc[text_i].extend_from_slice(wav_chunk);
                    dur_acc[text_i] += dur;
                }

                wave_offset = end;
            }
        }

        Ok(wav_acc.into_iter().zip(dur_acc.into_iter()).collect())
    }
}

pub fn load_voice_style(voice_style_paths: &[String], verbose: bool) -> Result<Style> {
    let bsz = voice_style_paths.len();
    let first_file =
        File::open(&voice_style_paths[0]).context("Failed to open voice style file")?;
    let first_reader = BufReader::new(first_file);
    let first_data: VoiceStyleData = serde_json::from_reader(first_reader)?;
    let ttl_dims = &first_data.style_ttl.dims;
    let dp_dims = &first_data.style_dp.dims;
    let ttl_dim1 = ttl_dims[1];
    let ttl_dim2 = ttl_dims[2];
    let dp_dim1 = dp_dims[1];
    let dp_dim2 = dp_dims[2];

    let ttl_size = bsz * ttl_dim1 * ttl_dim2;
    let dp_size = bsz * dp_dim1 * dp_dim2;
    let mut ttl_flat = vec![0.0f32; ttl_size];
    let mut dp_flat = vec![0.0f32; dp_size];

    for (i, path) in voice_style_paths.iter().enumerate() {
        let file = File::open(path).context("Failed to open voice style file")?;
        let reader = BufReader::new(file);
        let data: VoiceStyleData = serde_json::from_reader(reader)?;

        let ttl_offset = i * ttl_dim1 * ttl_dim2;
        let mut idx = 0;
        for batch in &data.style_ttl.data {
            for row in batch {
                for &val in row {
                    ttl_flat[ttl_offset + idx] = val;
                    idx += 1;
                }
            }
        }

        let dp_offset = i * dp_dim1 * dp_dim2;
        idx = 0;
        for batch in &data.style_dp.data {
            for row in batch {
                for &val in row {
                    dp_flat[dp_offset + idx] = val;
                    idx += 1;
                }
            }
        }
    }

    let ttl_style = Array3::from_shape_vec((bsz, ttl_dim1, ttl_dim2), ttl_flat)?;
    let dp_style = Array3::from_shape_vec((bsz, dp_dim1, dp_dim2), dp_flat)?;
    if verbose {
        log::info!("Loaded {} voice styles", bsz);
    }
    Ok(Style {
        ttl: ttl_style,
        dp: dp_style,
    })
}

pub fn load_text_to_speech(onnx_dir: &str, use_gpu: bool) -> Result<TextToSpeech> {
    if use_gpu {
        bail!("GPU mode is not supported yet");
    }
    #[cfg(target_os = "ios")]
    log::debug!(
        "Supertonic TTS: preferring CPU EP on iOS (CoreML optional, soft-fail → CPU)"
    );
    #[cfg(not(target_os = "ios"))]
    log::debug!("Supertonic TTS: using WebGPU (ONNX Runtime) for inference");

    let cfgs = load_cfgs(onnx_dir)?;
    let dp_path = format!("{}/duration_predictor.onnx", onnx_dir);
    let text_enc_path = format!("{}/text_encoder.onnx", onnx_dir);
    let vector_est_path = format!("{}/vector_estimator.onnx", onnx_dir);
    let vocoder_path = format!("{}/vocoder.onnx", onnx_dir);

    let build_session = |path: &str| -> Result<Session> {
        let builder =
            Session::builder().map_err(|e| anyhow!("ORT session builder init failed: {e}"))?;
        // iOS: prefer CPU to avoid CoreML compile-time memory spikes that OOM the process.
        // CoreML is registered without error_on_failure so unsupported nodes fall back to CPU
        // instead of aborting session creation.
        #[cfg(target_os = "ios")]
        let mut builder = builder
            .with_execution_providers([
                // ep::CPU::default().build(),
                ep::CoreML::default().build(),
            ])
            .map_err(|e| anyhow!("ORT execution provider setup failed: {e}"))?;
        #[cfg(not(target_os = "ios"))]
        let mut builder = builder
            .with_execution_providers([ep::WebGPU::default().build().error_on_failure()])
            .map_err(|e| anyhow!("ORT execution provider setup failed: {e}"))?;
        let session = builder
            .commit_from_file(path)
            .map_err(|e| anyhow!("ORT failed to load model '{}': {e}", path))?;
        Ok(session)
    };

    let dp_ort = build_session(&dp_path)?;
    let text_enc_ort = build_session(&text_enc_path)?;
    let vector_est_ort = build_session(&vector_est_path)?;
    let vocoder_ort = build_session(&vocoder_path)?;

    let unicode_indexer_path = format!("{}/unicode_indexer.json", onnx_dir);
    let text_processor = UnicodeProcessor::new(&unicode_indexer_path)?;

    Ok(TextToSpeech::new(
        cfgs,
        text_processor,
        dp_ort,
        text_enc_ort,
        vector_est_ort,
        vocoder_ort,
    ))
}
