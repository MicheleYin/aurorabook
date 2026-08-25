//! Generate `resources/voice-samples/{lang}/{F1..M5}.mp3` previews.
//!
//! Uses the same in-tree Supertonic ONNX stack as the Tauri app.
//!
//! Run from `tts-tauri/src-tauri`:
//!   cargo run --release --features gen-voice-samples --bin gen_voice_samples
//!
//! Or: `cargo gen-voice-samples`
//!
//! Optional env (defaults: bundled `resources/supertonic/`):
//!   SUPERTONIC_ONNX_DIR, SUPERTONIC_VOICES_ROOT, VOICE_SAMPLES_OUT

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use aurorabook_lib::tts::supertonic::core::AVAILABLE_LANGS;
use aurorabook_lib::tts::supertonic::koko::{InitConfig, TTSKokoParallel};

const VOICES: &[&str] = &[
    "F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5",
];

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
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
             Sync assets or set SUPERTONIC_ONNX_DIR.",
            onnx_dir
        );
        std::process::exit(1);
    }
    let styles = Path::new(&voices_root).join("voice_styles");
    if !styles.is_dir() && !Path::new(&voices_root).is_dir() {
        eprintln!("error: expected voice_styles under: {}", voices_root);
        std::process::exit(1);
    }
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("error: ffmpeg not found on PATH (needed for MP3 encoding).");
        std::process::exit(1);
    }

    eprintln!(
        "Loading TTS…\n  ONNX:   {}\n  Voices: {}\n  Out:    {}\n  Languages: {} × {} voices",
        onnx_dir,
        voices_root,
        out_dir,
        AVAILABLE_LANGS.len(),
        VOICES.len()
    );

    let tts = TTSKokoParallel::from_config_with_instances(
        &onnx_dir,
        &voices_root,
        InitConfig {
            sample_rate: 44_100,
            // Slightly faster than default for bulk sample generation.
            total_step: 5,
        },
        1,
    )
    .await
    .map_err(|e| format!("TTS init failed: {e}"))?;

    let sample_rate = tts.sample_rate();
    let wav_path = Path::new(&out_dir).join("_aurora_gen_voice_sample.tmp.wav");
    let total = AVAILABLE_LANGS.len() * VOICES.len();
    let mut done = 0usize;

    for lang in AVAILABLE_LANGS {
        let text = sample_text(lang);
        let lang_out = Path::new(&out_dir).join(lang);
        std::fs::create_dir_all(&lang_out)?;

        for voice in VOICES {
            done += 1;
            let mp3 = lang_out.join(format!("{}.mp3", voice));
            eprint!("  [{:>3}/{}] {} / {} … ", done, total, lang, voice);

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

            write_wav_f32_pcm16(&wav_path, &audio, sample_rate)?;

            let st = Command::new("ffmpeg")
                .args(["-y", "-loglevel", "error", "-i"])
                .arg(&wav_path)
                .args(["-codec:a", "libmp3lame", "-qscale:a", "4"])
                .arg(&mp3)
                .status()?;
            if !st.success() {
                return Err(format!("ffmpeg failed for {}", mp3.display()).into());
            }
            eprintln!("ok ({:.1}s)", audio.len() as f32 / sample_rate as f32);
        }
    }

    let _ = std::fs::remove_file(&wav_path);
    eprintln!(
        "Done. Wrote {} MP3s under {}",
        total,
        PathBuf::from(&out_dir).display()
    );
    Ok(())
}

/// Short native-script preview line per Supertonic language.
fn sample_text(lang: &str) -> &'static str {
    match lang {
        "en" => "Hello from AuroraBook. This is a quick preview of this voice.",
        "ko" => "안녕하세요, 오로라북입니다. 이 음성의 미리듣기입니다.",
        "ja" => "こんにちは、オーロラブックです。この声のプレビューです。",
        "bg" => "Здравейте от AuroraBook. Това е кратък преглед на този глас.",
        "cs" => "Ahoj z AuroraBook. Toto je krátká ukázka tohoto hlasu.",
        "da" => "Hej fra AuroraBook. Dette er en kort forhåndsvisning af denne stemme.",
        "de" => "Hallo von AuroraBook. Das ist eine kurze Vorschau dieser Stimme.",
        "el" => "Γεια σας από το AuroraBook. Αυτή είναι μια σύντομη προεπισκόπηση αυτής της φωνής.",
        "es" => "Hola, esto es AuroraBook. Una muestra breve de esta voz.",
        "et" => "Tere AuroraBookist. See on selle hääle lühike eelvaade.",
        "fi" => "Hei AuroraBookista. Tämä on lyhyt esikatselu tästä äänestä.",
        "fr" => "Bonjour, c'est AuroraBook. Un aperçu rapide de cette voix.",
        "hi" => "ऑरोराबुक से नमस्ते। यह इस आवाज़ का एक संक्षिप्त पूर्वावलोकन है।",
        "hr" => "Bok od AuroraBooka. Ovo je kratki pregled ovog glasa.",
        "hu" => "Helló az AuroraBooktól. Ez a hang rövid előnézete.",
        "id" => "Halo dari AuroraBook. Ini adalah pratinjau singkat suara ini.",
        "it" => "Ciao da AuroraBook. Questa è una breve anteprima di questa voce.",
        "lt" => "Sveiki iš AuroraBook. Tai trumpa šio balso peržiūra.",
        "lv" => "Sveiki no AuroraBook. Šis ir īss šīs balss priekšskatījums.",
        "nl" => "Hallo van AuroraBook. Dit is een korte preview van deze stem.",
        "pl" => "Cześć z AuroraBook. To krótki podgląd tego głosu.",
        "pt" => "Olá, isto é o AuroraBook. Uma amostra rápida desta voz.",
        "ro" => "Bună de la AuroraBook. Aceasta este o scurtă previzualizare a acestei voci.",
        "ru" => "Привет от AuroraBook. Это краткий образец этого голоса.",
        "sk" => "Ahoj z AuroraBook. Toto je krátka ukážka tohto hlasu.",
        "sl" => "Živjo od AuroraBook. To je kratek predogled tega glasu.",
        "sv" => "Hej från AuroraBook. Det här är en kort förhandsvisning av den här rösten.",
        "tr" => "AuroraBook'tan merhaba. Bu sesin kısa bir önizlemesi.",
        "uk" => "Привіт від AuroraBook. Це короткий попередній перегляд цього голосу.",
        "vi" => "Xin chào từ AuroraBook. Đây là bản xem trước ngắn của giọng nói này.",
        _ => "Hello from AuroraBook. This is a quick preview of this voice.",
    }
}

fn write_wav_f32_pcm16(
    path: &Path,
    audio: &[f32],
    sample_rate: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut file = File::create(path)?;
    let num_samples = audio.len();
    let data_size = num_samples * 2;
    let file_size = 36 + data_size;

    file.write_all(b"RIFF")?;
    file.write_all(&(file_size as u32).to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&(sample_rate * 2).to_le_bytes())?;
    file.write_all(&2u16.to_le_bytes())?;
    file.write_all(&16u16.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&(data_size as u32).to_le_bytes())?;

    for &sample in audio {
        let clamped = sample.clamp(-1.0, 1.0);
        let pcm = if clamped < 0.0 {
            (clamped * 32768.0) as i16
        } else {
            (clamped * 32767.0) as i16
        };
        file.write_all(&pcm.to_le_bytes())?;
    }
    Ok(())
}
