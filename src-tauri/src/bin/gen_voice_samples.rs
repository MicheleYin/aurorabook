//! Generate `resources/voice-samples/{lang}/{F1..M5}.mp3` previews.
//!
//! Uses the same in-tree Supertonic ONNX stack as the Tauri app.
//! The standalone `koko` CLI under `koko/` may use a different `ort` version
//! and fail to load ONNX with "Protobuf parsing failed"; prefer this binary.
//!
//! Run from `tts-tauri/src-tauri`:
//!   cargo run --release --bin gen_voice_samples
//!
//! Optional env (defaults: bundled `resources/supertonic/`):
//!   SUPERTONIC_ONNX_DIR, SUPERTONIC_VOICES_ROOT, VOICE_SAMPLES_OUT

use std::path::Path;
use std::process::Command;

use aurorabook_lib::tts::supertonic::koko::TTSKokoParallel;
use hound::{SampleFormat, WavSpec, WavWriter};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = std::env::var("CARGO_MANIFEST_DIR")?;
    let onnx_dir = std::env::var("SUPERTONIC_ONNX_DIR").unwrap_or_else(|_| {
        format!("{}/resources/supertonic/onnx", manifest)
    });
    let voices_root = std::env::var("SUPERTONIC_VOICES_ROOT").unwrap_or_else(|_| {
        format!("{}/resources/supertonic", manifest)
    });
    let out_dir = std::env::var("VOICE_SAMPLES_OUT").unwrap_or_else(|_| {
        format!("{}/resources/voice-samples", manifest)
    });

    if !Path::new(&onnx_dir).join("tts.json").exists() {
        eprintln!(
            "error: Supertonic ONNX dir invalid (no tts.json): {}\n\
             Build once so `build.rs` syncs assets, or set SUPERTONIC_ONNX_DIR.",
            onnx_dir
        );
        std::process::exit(1);
    }
    if !Path::new(&voices_root).join("voice_styles").is_dir() {
        eprintln!(
            "error: expected voice_styles under: {}",
            voices_root
        );
        std::process::exit(1);
    }
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("error: ffmpeg not found on PATH (needed for MP3 encoding).");
        std::process::exit(1);
    }

    eprintln!(
        "Loading TTS (same stack as aurorabook app)…\n  ONNX: {}\n  Voices: {}",
        onnx_dir, voices_root
    );
    let tts = TTSKokoParallel::new_with_instances(&onnx_dir, &voices_root, 1).await;

    let langs = ["en", "ko", "es", "pt", "fr"];
    let voices = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"];
    let wav_path = std::env::temp_dir().join("aurora_gen_voice_sample.wav");

    for lang in langs {
        let text = sample_text(lang);
        let lang_out = Path::new(&out_dir).join(lang);
        std::fs::create_dir_all(&lang_out)?;

        for voice in voices {
            let mp3 = lang_out.join(format!("{}.mp3", voice));
            eprintln!("  {} / {} …", lang, voice);

            let instance = tts.get_model_instance(0);
            let audio = tts
                .tts_raw_audio_with_instance(
                    text,
                    lang,
                    voice,
                    1.0,
                    None,
                    None,
                    None,
                    None,
                    instance,
                )
                .map_err(|e| format!("TTS failed for {lang}/{voice}: {e}"))?;
            write_wav_f32(wav_path.as_path(), &audio, 44_100)?;

            let st = Command::new("ffmpeg")
                .args(["-y", "-loglevel", "error", "-i"])
                .arg(&wav_path)
                .args(["-codec:a", "libmp3lame", "-qscale:a", "4"])
                .arg(&mp3)
                .status()?;
            if !st.success() {
                return Err(format!("ffmpeg failed for {}", mp3.display()).into());
            }
        }
    }

    let _ = std::fs::remove_file(&wav_path);
    eprintln!("Done. Output: {}", out_dir);
    Ok(())
}

fn sample_text(lang: &str) -> &'static str {
    match lang {
        "en" => "Hello from AuroraBook. This is a quick preview of this voice.",
        "ko" => "안녕하세요, 오로라북입니다. 이 음성의 미리듣기입니다.",
        "es" => "Hola, esto es AuroraBook. Una muestra breve de esta voz.",
        "pt" => "Olá, isto é o AuroraBook. Uma amostra rápida desta voz.",
        "fr" => "Bonjour, c'est AuroraBook. Un aperçu rapide de cette voix.",
        _ => "Hello from AuroraBook.",
    }
}

fn write_wav_f32(path: &Path, audio: &[f32], sample_rate: u32) -> Result<(), Box<dyn std::error::Error>> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 32,
        sample_format: SampleFormat::Float,
    };
    let mut writer = WavWriter::create(path, spec)?;
    for &sample in audio {
        writer.write_sample(sample)?;
    }
    writer.finalize()?;
    Ok(())
}
