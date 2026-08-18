//! Estimate per-word audio timings from a finished utterance waveform.
//!
//! Supertonic synthesizes complete utterances and only returns a scalar duration,
//! so word windows are derived from grapheme weights, punctuation pauses, and
//! leading/trailing silence in the PCM.

use crate::tts::koko::WordAlignment;

const WINDOW_MS: f32 = 20.0;
const RMS_FLOOR: f32 = 0.008;
const COMMA_PAUSE_SEC: f32 = 0.05;
const SENTENCE_PAUSE_SEC: f32 = 0.12;
const MAX_PAUSE_FRACTION: f32 = 0.25;

/// Estimate word-level `[start_sec, end_sec)` windows for `text` given PCM `samples`.
///
/// The first word starts at speech onset (leading silence is not assigned to it).
/// Windows are contiguous through the speech span.
pub fn estimate_word_timings(
    text: &str,
    samples: &[f32],
    sample_rate: u32,
) -> Vec<WordAlignment> {
    let words: Vec<String> = text
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    if words.is_empty() {
        return Vec::new();
    }

    let sample_rate = sample_rate.max(1);
    let total_duration = pcm_duration_seconds(samples.len(), sample_rate);
    if samples.is_empty() || total_duration <= 0.0 {
        return uniform_fallback(&words, 0.0);
    }

    let (speech_start, speech_end) = speech_span(samples, sample_rate);
    let speech_dur = (speech_end - speech_start).max(0.0);
    if speech_dur <= 0.0 {
        return uniform_fallback(&words, total_duration.max(0.001));
    }

    let weights: Vec<f32> = words.iter().map(|w| word_weight(w)).collect();
    let weight_sum: f32 = weights.iter().sum::<f32>().max(1.0);

    let raw_pauses: Vec<f32> = words.iter().map(|w| pause_after(w)).collect();
    let pause_sum: f32 = raw_pauses.iter().sum();
    let max_pause = speech_dur * MAX_PAUSE_FRACTION;
    let pause_scale = if pause_sum > max_pause && pause_sum > 0.0 {
        max_pause / pause_sum
    } else {
        1.0
    };
    let pauses: Vec<f32> = raw_pauses.iter().map(|p| p * pause_scale).collect();
    let pause_budget: f32 = pauses.iter().sum();
    let speech_for_words = (speech_dur - pause_budget).max(speech_dur * 0.5);

    let n = words.len();
    let mut desired: Vec<f32> = Vec::with_capacity(n);
    for idx in 0..n {
        let word_dur = speech_for_words * (weights[idx] / weight_sum);
        let pause = if idx + 1 < n { pauses[idx] } else { 0.0 };
        desired.push((word_dur + pause).max(0.0));
    }
    let desired_sum = desired.iter().copied().sum::<f32>().max(1e-6);
    let scale = speech_dur / desired_sum;

    let mut alignments = Vec::with_capacity(n);
    let mut cursor = speech_start;
    for (idx, word) in words.iter().enumerate() {
        let start_sec = cursor;
        let end_sec = if idx + 1 == n {
            speech_end
        } else {
            (start_sec + desired[idx] * scale).min(speech_end)
        };
        alignments.push(WordAlignment {
            word: word.clone(),
            start_sec,
            end_sec: end_sec.max(start_sec),
        });
        cursor = alignments.last().map(|a| a.end_sec).unwrap_or(cursor);
    }

    fit_alignments_to_pcm_duration(&mut alignments, total_duration);
    alignments
}

/// Audio length in seconds from generated PCM (`samples.len() / sample_rate`).
pub fn pcm_duration_seconds(sample_count: usize, sample_rate: u32) -> f32 {
    if sample_count == 0 {
        return 0.0;
    }
    sample_count as f32 / sample_rate.max(1) as f32
}

/// Stretch sentence-relative word windows so they fill `[0, pcm_duration]`.
///
/// Proportions stay the same; trailing PCM that speech-onset detection missed is
/// spread across the utterance instead of dumping onto the last word. The last
/// word always ends at the generated audio length.
pub fn fit_alignments_to_pcm_duration(alignments: &mut [WordAlignment], pcm_duration: f32) {
    if alignments.is_empty() {
        return;
    }
    let pcm = pcm_duration.max(0.0);
    let first = alignments[0].start_sec.max(0.0).min(pcm);
    let last_end = alignments
        .last()
        .map(|alignment| alignment.end_sec.max(alignment.start_sec))
        .unwrap_or(first)
        .max(first);
    let src_span = (last_end - first).max(1e-6);
    let dest_span = (pcm - first).max(0.0);
    let scale = dest_span / src_span;
    for alignment in alignments.iter_mut() {
        alignment.start_sec = first + (alignment.start_sec - first) * scale;
        alignment.end_sec = first + (alignment.end_sec - first) * scale;
    }
    clamp_word_alignments(alignments, 0.0, pcm);
}

/// Offset sentence-relative word windows onto the chapter timeline and fit
/// them to `[track_start_sec, track_start_sec + sentence_duration_sec]`.
///
/// `sentence_duration_sec` must be the generated PCM length
/// (`samples.len() / sample_rate`). The chapter clock advances by that length,
/// not by the last estimated word end, so later sentences cannot drift.
pub fn place_alignments_on_track(
    alignments: &[WordAlignment],
    track_start_sec: f32,
    sentence_duration_sec: f32,
) -> Vec<WordAlignment> {
    let duration = sentence_duration_sec.max(0.0);
    let mut fitted = alignments.to_vec();
    fit_alignments_to_pcm_duration(&mut fitted, duration);
    let track_end_sec = track_start_sec + duration;
    for alignment in &mut fitted {
        alignment.start_sec += track_start_sec;
        alignment.end_sec += track_start_sec;
    }
    clamp_word_alignments(&mut fitted, track_start_sec, track_end_sec);
    fitted
}

/// Keep every word window inside `[lo, hi]` (the sentence/utterance clip).
///
/// The last word is extended to `hi` so highlight can cover trailing silence
/// without leaving the sentence span.
pub fn clamp_word_alignments(alignments: &mut [WordAlignment], lo: f32, hi: f32) {
    if alignments.is_empty() {
        return;
    }
    let span_lo = lo.min(hi);
    let span_hi = lo.max(hi);
    for alignment in alignments.iter_mut() {
        alignment.start_sec = alignment.start_sec.max(span_lo).min(span_hi);
        alignment.end_sec = alignment.end_sec.max(span_lo).min(span_hi);
        if alignment.end_sec < alignment.start_sec {
            alignment.end_sec = alignment.start_sec;
        }
    }
    if let Some(last) = alignments.last_mut() {
        last.end_sec = span_hi;
        if last.end_sec < last.start_sec {
            last.start_sec = last.end_sec;
        }
    }
}

/// Word index whose window contains `time_sec` (sentence-relative).
pub fn word_index_at_time(alignments: &[WordAlignment], time_sec: f32) -> Option<usize> {
    if alignments.is_empty() {
        return None;
    }

    let mut lo = 0usize;
    let mut hi = alignments.len() - 1;
    while lo <= hi {
        let mid = (lo + hi) / 2;
        let start = alignments[mid].start_sec;
        let end = alignments[mid].end_sec;
        let is_last = mid + 1 == alignments.len();
        let in_range = if is_last {
            time_sec >= start && time_sec <= end
        } else {
            time_sec >= start && time_sec < end
        };
        if in_range {
            return Some(mid);
        }
        if time_sec < start {
            if mid == 0 {
                break;
            }
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }

    if time_sec < alignments[0].start_sec {
        return Some(0);
    }
    Some(alignments.len() - 1)
}

fn word_weight(word: &str) -> f32 {
    let alnum = word.chars().filter(|c| c.is_alphanumeric()).count();
    (alnum as f32).max(1.0)
}

fn pause_after(word: &str) -> f32 {
    let trimmed = word.trim_end();
    let Some(last) = trimmed.chars().last() else {
        return 0.0;
    };
    match last {
        '.' | '!' | '?' | '…' => SENTENCE_PAUSE_SEC,
        ',' | ';' | ':' => COMMA_PAUSE_SEC,
        _ => 0.0,
    }
}

fn speech_span(samples: &[f32], sample_rate: u32) -> (f32, f32) {
    let window = ((sample_rate as f32 * WINDOW_MS / 1000.0) as usize).max(1);
    let threshold = rms_threshold(samples);

    let mut first_speech: Option<usize> = None;
    let mut last_speech: Option<usize> = None;
    let mut offset = 0usize;
    while offset < samples.len() {
        let end = (offset + window).min(samples.len());
        let rms = window_rms(&samples[offset..end]);
        if rms >= threshold {
            if first_speech.is_none() {
                first_speech = Some(offset);
            }
            last_speech = Some(end);
        }
        if end == samples.len() {
            break;
        }
        offset = end;
    }

    let total = samples.len() as f32 / sample_rate as f32;
    let start = first_speech
        .map(|i| i as f32 / sample_rate as f32)
        .unwrap_or(0.0);
    let end = last_speech
        .map(|i| i as f32 / sample_rate as f32)
        .unwrap_or(total)
        .max(start);
    (start.min(total), end.min(total).max(start))
}

fn rms_threshold(samples: &[f32]) -> f32 {
    let peak = samples
        .iter()
        .fold(0.0f32, |acc, &s| acc.max(s.abs()));
    (peak * 0.02).max(RMS_FLOOR)
}

fn window_rms(window: &[f32]) -> f32 {
    if window.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = window.iter().map(|s| s * s).sum();
    (sum_sq / window.len() as f32).sqrt()
}

fn uniform_fallback(words: &[String], duration: f32) -> Vec<WordAlignment> {
    let n = words.len() as f32;
    let dur = duration.max(0.001);
    let each = dur / n;
    let mut alignments: Vec<WordAlignment> = words
        .iter()
        .enumerate()
        .map(|(idx, word)| {
            let start_sec = idx as f32 * each;
            WordAlignment {
                word: word.clone(),
                start_sec,
                end_sec: start_sec + each,
            }
        })
        .collect();
    clamp_word_alignments(&mut alignments, 0.0, dur);
    alignments
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f32, sample_rate: u32, amplitude: f32) -> Vec<f32> {
        let n = (seconds * sample_rate as f32) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                (t * 440.0 * 2.0 * std::f32::consts::PI).sin() * amplitude
            })
            .collect()
    }

    fn silence(seconds: f32, sample_rate: u32) -> Vec<f32> {
        vec![0.0; (seconds * sample_rate as f32) as usize]
    }

    #[test]
    fn empty_text_returns_no_alignments() {
        let audio = tone(0.5, 44_100, 0.3);
        assert!(estimate_word_timings("   ", &audio, 44_100).is_empty());
    }

    #[test]
    fn empty_audio_is_safe() {
        let alignments = estimate_word_timings("hello world", &[], 44_100);
        assert_eq!(alignments.len(), 2);
        assert!(alignments[0].end_sec > alignments[0].start_sec);
    }

    #[test]
    fn long_words_get_more_time_than_short_words() {
        let audio = tone(2.0, 44_100, 0.4);
        let alignments = estimate_word_timings("a extraordinary", &audio, 44_100);
        assert_eq!(alignments.len(), 2);
        let short = alignments[0].end_sec - alignments[0].start_sec;
        let long = alignments[1].end_sec - alignments[1].start_sec;
        assert!(
            long > short * 2.0,
            "expected long word ({long}) >> short word ({short})"
        );
    }

    #[test]
    fn leading_silence_does_not_pad_the_first_word() {
        let sample_rate = 44_100u32;
        let mut audio = silence(0.4, sample_rate);
        audio.extend(tone(0.8, sample_rate, 0.5));
        let alignments = estimate_word_timings("hello world", &audio, sample_rate);
        assert_eq!(alignments.len(), 2);
        assert!(
            alignments[0].start_sec >= 0.3,
            "first word should start near speech onset, got {}",
            alignments[0].start_sec
        );
        let first_dur = alignments[0].end_sec - alignments[0].start_sec;
        assert!(
            first_dur < 0.7,
            "first word duration should not include leading silence, got {first_dur}"
        );
        assert!(
            (alignments.last().unwrap().end_sec - 1.2).abs() < 1e-3,
            "last word must end at generated PCM duration"
        );
    }

    #[test]
    fn punctuation_adds_pause_after_the_preceding_word() {
        let audio = tone(2.0, 44_100, 0.4);
        let with_comma = estimate_word_timings("hello, world extra", &audio, 44_100);
        let plain = estimate_word_timings("hello world extra", &audio, 44_100);
        assert_eq!(with_comma.len(), 3);
        let comma_first = with_comma[0].end_sec - with_comma[0].start_sec;
        let plain_first = plain[0].end_sec - plain[0].start_sec;
        assert!(
            comma_first > plain_first,
            "comma word ({comma_first}) should be longer than plain ({plain_first})"
        );
    }

    #[test]
    fn windows_are_contiguous_and_ordered() {
        let audio = tone(1.5, 44_100, 0.3);
        let alignments = estimate_word_timings("one two three four", &audio, 44_100);
        for i in 1..alignments.len() {
            assert!(
                (alignments[i].start_sec - alignments[i - 1].end_sec).abs() < 1e-4,
                "gap between word {} and {}",
                i - 1,
                i
            );
            assert!(alignments[i].end_sec >= alignments[i].start_sec);
        }
    }

    #[test]
    fn words_never_leave_the_utterance_span() {
        let sample_rate = 44_100u32;
        let audio = tone(0.25, sample_rate, 0.4);
        let total = audio.len() as f32 / sample_rate as f32;
        let alignments = estimate_word_timings(
            "Hi, there, yes, no, ok, wait, sure, fine, go, now.",
            &audio,
            sample_rate,
        );
        assert!(!alignments.is_empty());
        for alignment in &alignments {
            assert!(
                alignment.start_sec >= -1e-4,
                "word start {} is before 0",
                alignment.start_sec
            );
            assert!(
                alignment.end_sec <= total + 1e-3,
                "word end {} exceeds duration {total}",
                alignment.end_sec
            );
            assert!(alignment.end_sec >= alignment.start_sec);
        }
        assert!(
            (alignments.last().unwrap().end_sec - total).abs() < 1e-3,
            "last word should cover the utterance end"
        );
    }

    #[test]
    fn clamp_word_alignments_pulls_overshoot_inside_clip() {
        let mut alignments = vec![
            WordAlignment {
                word: "one".to_string(),
                start_sec: -0.2,
                end_sec: 0.4,
            },
            WordAlignment {
                word: "two".to_string(),
                start_sec: 0.4,
                end_sec: 1.8,
            },
        ];
        clamp_word_alignments(&mut alignments, 0.0, 1.0);
        assert!(alignments[0].start_sec >= 0.0);
        assert!(alignments[0].end_sec <= 1.0);
        assert!(alignments[1].start_sec >= 0.0);
        assert!((alignments[1].end_sec - 1.0).abs() < 1e-6);
    }

    #[test]
    fn word_index_at_time_uses_last_word_at_and_past_clip_end() {
        let alignments = vec![
            WordAlignment {
                word: "one".to_string(),
                start_sec: 0.0,
                end_sec: 0.5,
            },
            WordAlignment {
                word: "two".to_string(),
                start_sec: 0.5,
                end_sec: 1.0,
            },
        ];
        assert_eq!(word_index_at_time(&alignments, 0.2), Some(0));
        assert_eq!(word_index_at_time(&alignments, 0.5), Some(1));
        assert_eq!(word_index_at_time(&alignments, 1.0), Some(1));
        assert_eq!(word_index_at_time(&alignments, 1.4), Some(1));
        assert_eq!(word_index_at_time(&alignments, -0.1), Some(0));
    }

    #[test]
    fn place_alignments_on_track_uses_pcm_duration_not_last_word_end() {
        let alignments = vec![
            WordAlignment {
                word: "one".to_string(),
                start_sec: 0.0,
                end_sec: 0.4,
            },
            WordAlignment {
                word: "two".to_string(),
                start_sec: 0.4,
                end_sec: 0.7,
            },
        ];
        let track_start = 10.0;
        let sentence_duration = 1.2;
        let placed = place_alignments_on_track(&alignments, track_start, sentence_duration);
        assert_eq!(placed.len(), 2);
        assert!(placed[0].start_sec >= track_start - 1e-4);
        assert!((placed[1].end_sec - (track_start + sentence_duration)).abs() < 1e-4);
        let first_span = placed[0].end_sec - placed[0].start_sec;
        let second_span = placed[1].end_sec - placed[1].start_sec;
        assert!(
            (first_span / 0.4 - second_span / 0.3).abs() < 0.05,
            "relative word lengths must be preserved when fitting to PCM duration"
        );
        for alignment in &placed {
            assert!(alignment.start_sec >= track_start - 1e-4);
            assert!(alignment.end_sec <= track_start + sentence_duration + 1e-4);
        }
    }

    #[test]
    fn consecutive_sentences_do_not_inherit_short_word_ends() {
        let first = vec![WordAlignment {
            word: "Hi.".to_string(),
            start_sec: 0.0,
            end_sec: 0.4,
        }];
        let second = vec![WordAlignment {
            word: "Later.".to_string(),
            start_sec: 0.0,
            end_sec: 0.5,
        }];
        let first_pcm = pcm_duration_seconds(44_100, 44_100);
        let second_pcm = pcm_duration_seconds(22_050, 44_100);
        let placed_first = place_alignments_on_track(&first, 0.0, first_pcm);
        let placed_second = place_alignments_on_track(&second, first_pcm, second_pcm);
        assert!((placed_first.last().unwrap().end_sec - first_pcm).abs() < 1e-4);
        assert!((placed_second[0].start_sec - first_pcm).abs() < 1e-4);
        assert!((placed_second.last().unwrap().end_sec - (first_pcm + second_pcm)).abs() < 1e-4);
    }
}
