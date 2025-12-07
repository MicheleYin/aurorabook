//! Tests for utils::audio module
//!
//! Tests audio processing functions:
//! - f32_to_pcm_le_bytes

use aurorabook_lib::utils::audio;

#[test]
fn test_f32_to_pcm_le_bytes_basic() {
    let samples = vec![0.0, 0.5, -0.5, 1.0, -1.0];
    let pcm_bytes = audio::f32_to_pcm_le_bytes(&samples);
    
    assert_eq!(pcm_bytes.len(), samples.len() * 2); // 16-bit = 2 bytes per sample
}

#[test]
fn test_f32_to_pcm_le_bytes_zero() {
    let samples = vec![0.0; 10];
    let pcm_bytes = audio::f32_to_pcm_le_bytes(&samples);
    
    assert_eq!(pcm_bytes.len(), 20);
    // All bytes should be zero for zero samples
    assert!(pcm_bytes.iter().all(|&b| b == 0));
}

#[test]
fn test_f32_to_pcm_le_bytes_clamping() {
    // Test that values outside [-1.0, 1.0] are clamped
    let samples = vec![2.0, -2.0, 1.5, -1.5];
    let pcm_bytes = audio::f32_to_pcm_le_bytes(&samples);
    
    assert_eq!(pcm_bytes.len(), 8);
    // Should not panic and should produce valid PCM
}

#[test]
fn test_f32_to_pcm_le_bytes_positive_range() {
    let samples = vec![0.0, 0.25, 0.5, 0.75, 1.0];
    let pcm_bytes = audio::f32_to_pcm_le_bytes(&samples);
    
    assert_eq!(pcm_bytes.len(), 10);
    // Positive values should map to positive PCM values
}

#[test]
fn test_f32_to_pcm_le_bytes_negative_range() {
    let samples = vec![0.0, -0.25, -0.5, -0.75, -1.0];
    let pcm_bytes = audio::f32_to_pcm_le_bytes(&samples);
    
    assert_eq!(pcm_bytes.len(), 10);
    // Negative values should map to negative PCM values
}

#[test]
fn test_f32_to_pcm_le_bytes_empty() {
    let samples = vec![];
    let pcm_bytes = audio::f32_to_pcm_le_bytes(&samples);
    
    assert_eq!(pcm_bytes.len(), 0);
}

#[test]
fn test_f32_to_pcm_le_bytes_little_endian() {
    // Test that bytes are in little-endian format
    let samples = vec![1.0];
    let pcm_bytes = audio::f32_to_pcm_le_bytes(&samples);
    
    assert_eq!(pcm_bytes.len(), 2);
    // For 1.0, should map to approximately 32767 (0x7FFF)
    // Little-endian: low byte first, high byte second
    let value = i16::from_le_bytes([pcm_bytes[0], pcm_bytes[1]]);
    assert!(value > 0);
    assert!(value <= 32767);
}

#[test]
fn test_f32_to_pcm_le_bytes_round_trip_consistency() {
    // Test that the same input produces the same output
    let samples = vec![0.5, -0.5, 0.0];
    use aurorabook_lib::utils::audio::f32_to_pcm_le_bytes;
    let pcm1 = f32_to_pcm_le_bytes(&samples);
    let pcm2 = f32_to_pcm_le_bytes(&samples);
    
    assert_eq!(pcm1, pcm2);
}

