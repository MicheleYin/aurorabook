use crate::utils::constants::SAMPLE_RATE;

/// Convert f32 audio samples to 16-bit PCM bytes (little-endian).
///
/// This function converts normalized floating-point audio samples (range [-1.0, 1.0])
/// to 16-bit signed integer PCM format suitable for WAV files or MP3 encoding.
///
/// The conversion:
/// - Clamps samples to [-1.0, 1.0] range
/// - Maps negative values to [-32768, 0] (i16 range)
/// - Maps positive values to [0, 32767] (i16 range)
/// - Converts to little-endian bytes
///
/// # Arguments
/// * `samples` - Vector of f32 audio samples in range [-1.0, 1.0]
///
/// # Returns
/// A vector of bytes representing 16-bit PCM audio (little-endian).
/// The output length is `samples.len() * 2` bytes.
///
/// # Example
/// ```rust
/// let samples = vec![0.0, 0.5, -0.5, 1.0, -1.0];
/// let pcm_bytes = f32_to_pcm_le_bytes(&samples);
/// assert_eq!(pcm_bytes.len(), 10); // 5 samples * 2 bytes
/// ```
pub fn f32_to_pcm_le_bytes(samples: &[f32]) -> Vec<u8> {
    let mut pcm_bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let clamped = sample.max(-1.0).min(1.0);
        let pcm_value = if clamped < 0.0 {
            (clamped * 32768.0) as i16
        } else {
            (clamped * 32767.0) as i16
        };
        pcm_bytes.extend_from_slice(&pcm_value.to_le_bytes());
    }
    pcm_bytes
}

/// Get the default sample rate used for TTS audio generation.
///
/// # Returns
/// The default sample rate in Hz (typically 24000 for Kokoros TTS).
///
/// # Example
/// ```rust
/// let sample_rate = default_sample_rate();
/// println!("Using sample rate: {} Hz", sample_rate);
/// ```
pub fn default_sample_rate() -> u32 {
    SAMPLE_RATE
}

