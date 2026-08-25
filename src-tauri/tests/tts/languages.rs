//! Smoke-test Supertonic TTS for every supported language code.
//!
//! Run (with model assets present):
//! ```text
//! cargo test --test mod tts::languages::test_tts_works_for_all_supported_languages -- --ignored --nocapture
//! ```

use aurorabook_lib::tts::supertonic::core::{is_valid_lang, AVAILABLE_LANGS};
use aurorabook_lib::tts::supertonic::koko::{InitConfig, TTSKokoParallel};

#[path = "../helpers.rs"]
mod helpers;
use helpers::{find_supertonic_onnx_dir, find_supertonic_voices_dir};

/// Short native-script phrase per Supertonic language (aligned with `AVAILABLE_LANGS`).
fn sample_text_for_lang(lang: &str) -> &'static str {
    match lang {
        "en" => "Hello, this is a test.",
        "ko" => "안녕하세요, 테스트입니다.",
        "ja" => "こんにちは、テストです。",
        "bg" => "Здравейте, това е тест.",
        "cs" => "Ahoj, toto je test.",
        "da" => "Hej, dette er en test.",
        "de" => "Hallo, das ist ein Test.",
        "el" => "Γεια σας, αυτό είναι μια δοκιμή.",
        "es" => "Hola, esto es una prueba.",
        "et" => "Tere, see on test.",
        "fi" => "Hei, tämä on testi.",
        "fr" => "Bonjour, ceci est un test.",
        "hi" => "नमस्ते, यह एक परीक्षण है।",
        "hr" => "Bok, ovo je test.",
        "hu" => "Helló, ez egy teszt.",
        "id" => "Halo, ini adalah tes.",
        "it" => "Ciao, questo è un test.",
        "lt" => "Labas, tai testas.",
        "lv" => "Sveiki, šis ir tests.",
        "nl" => "Hallo, dit is een test.",
        "pl" => "Cześć, to jest test.",
        "pt" => "Olá, isto é um teste.",
        "ro" => "Bună, acesta este un test.",
        "ru" => "Привет, это тест.",
        "sk" => "Ahoj, toto je test.",
        "sl" => "Živjo, to je test.",
        "sv" => "Hej, det här är ett test.",
        "tr" => "Merhaba, bu bir test.",
        "uk" => "Привіт, це тест.",
        "vi" => "Xin chào, đây là bài kiểm tra.",
        _ => "Hello, this is a test.",
    }
}

fn audio_has_energy(samples: &[f32]) -> bool {
    samples.iter().any(|s| s.abs() > 1e-4)
}

#[test]
fn test_available_langs_matches_supertonic_app_set() {
    // App intentionally omits Arabic (`ar`) from the upstream 31-language set.
    assert_eq!(
        AVAILABLE_LANGS.len(),
        30,
        "AVAILABLE_LANGS must stay in sync with frontend constants/languages.ts"
    );
    for lang in AVAILABLE_LANGS {
        assert!(is_valid_lang(lang), "listed lang should be valid: {lang}");
        assert!(
            !sample_text_for_lang(lang).is_empty(),
            "every supported lang needs a sample phrase: {lang}"
        );
    }
    assert!(!is_valid_lang("ar"));
    assert!(!is_valid_lang("zz"));
}

/// Synthesize a short phrase for every language in [`AVAILABLE_LANGS`].
///
/// Ignored by default (loads the real ONNX model; ~30 inferences). Requires
/// `resources/supertonic/onnx` and `voice_styles`, or parent `supertonic-3/`.
#[tokio::test]
#[ignore = "loads Supertonic ONNX and synthesizes all 30 languages; run with --ignored"]
async fn test_tts_works_for_all_supported_languages() {
    let onnx_dir = match find_supertonic_onnx_dir() {
        Some(p) => p,
        None => {
            println!("⚠️  Skipping: Supertonic ONNX directory not found");
            println!("   Expected: src-tauri/resources/supertonic/onnx or ../supertonic-3/onnx");
            return;
        }
    };
    let voices_dir = match find_supertonic_voices_dir() {
        Some(p) => p,
        None => {
            println!("⚠️  Skipping: Supertonic voice_styles directory not found");
            return;
        }
    };

    println!("📁 ONNX:   {}", onnx_dir.display());
    println!("📁 Voices: {}", voices_dir.display());
    println!(
        "🎤 Synthesizing {} languages with voice F1 (fastest quality)…",
        AVAILABLE_LANGS.len()
    );

    let engine = TTSKokoParallel::from_config_with_instances(
        onnx_dir.to_str().expect("utf-8 onnx path"),
        voices_dir.to_str().expect("utf-8 voices path"),
        InitConfig {
            sample_rate: 44_100,
            total_step: 5,
        },
        1,
    )
    .await
    .expect("Supertonic TTS init");

    let voice_id = "F1";
    let mut failures: Vec<String> = Vec::new();

    for (i, lang) in AVAILABLE_LANGS.iter().enumerate() {
        let text = sample_text_for_lang(lang);
        print!(
            "  [{:>2}/{}] {} … ",
            i + 1,
            AVAILABLE_LANGS.len(),
            lang
        );

        let model = engine.get_model_instance(0);
        match engine.tts_raw_audio_with_instance(
            text, lang, voice_id, 1.0, None, None, None, None, model,
        ) {
            Ok(samples) => {
                if samples.is_empty() {
                    println!("FAIL (empty audio)");
                    failures.push(format!("{lang}: empty audio"));
                } else if !audio_has_energy(&samples) {
                    println!("FAIL (silence)");
                    failures.push(format!("{lang}: audio is silence"));
                } else {
                    let secs = samples.len() as f32 / engine.sample_rate() as f32;
                    println!("OK ({:.2}s, {} samples)", secs, samples.len());
                }
            }
            Err(e) => {
                println!("FAIL ({e})");
                failures.push(format!("{lang}: {e}"));
            }
        }
    }

    assert!(
        failures.is_empty(),
        "TTS failed for {} language(s):\n  - {}",
        failures.len(),
        failures.join("\n  - ")
    );
    println!("✅ TTS works for all {} supported languages", AVAILABLE_LANGS.len());
}
