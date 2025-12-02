use crate::utils::constants::WAV_HEADER_SIZE;

/// Merge multiple PCM audio data arrays into a single WAV file.
///
/// This function concatenates multiple audio chunks (already in PCM format)
/// and wraps them in a WAV file header. The audio chunks are assumed to be
/// 16-bit PCM, mono channel, and at the specified sample rate.
///
/// # Arguments
/// * `audio_data_arrays` - Slice of byte vectors, each containing 16-bit PCM audio data
/// * `sample_rate` - Sample rate in Hz (typically 24000 for TTS)
///
/// # Returns
/// A complete WAV file as a byte vector, including the 44-byte WAV header
/// followed by the concatenated PCM data.
///
/// # WAV Format
/// The generated WAV file uses:
/// - Format: PCM (uncompressed)
/// - Channels: Mono (1 channel)
/// - Sample rate: As specified
/// - Bit depth: 16-bit
/// - Byte order: Little-endian
///
/// # Example
/// ```rust
/// let chunk1 = vec![0u8; 4800]; // 1 second of silence at 24kHz
/// let chunk2 = vec![0u8; 4800];
/// let wav = merge_wav_files(&[chunk1, chunk2], 24000);
/// std::fs::write("merged.wav", wav)?;
/// ```
pub fn merge_wav_files(audio_data_arrays: &[Vec<u8>], sample_rate: u32) -> Vec<u8> {
    if audio_data_arrays.is_empty() {
        return Vec::new();
    }
    
    // Calculate total length
    let total_length: usize = audio_data_arrays.iter().map(|a| a.len()).sum();
    
    // Create WAV header
    let mut wav = Vec::with_capacity(WAV_HEADER_SIZE + total_length);
    
    // RIFF header
    wav.extend_from_slice(b"RIFF");
    let file_size = (36 + total_length) as u32;
    wav.extend_from_slice(&file_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    
    // fmt chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * 2; // 16-bit = 2 bytes per sample
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes()); // block align
    wav.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    
    // data chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(total_length as u32).to_le_bytes());
    
    // Concatenate audio data
    for audio_data in audio_data_arrays {
        wav.extend_from_slice(audio_data);
    }
    
    wav
}

