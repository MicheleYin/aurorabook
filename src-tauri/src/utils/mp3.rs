//! MPEG-1/2 Layer III frame duration.
//!
//! Live playback concatenates independently encoded sentence MP3s. Each encode
//! carries LAME Info/padding frames, so the browser clock is longer than the
//! source PCM. Word/sentence sync must follow that concatenated duration.

const BITRATE_MPEG1_L3: [u32; 16] = [
    0, 32_000, 40_000, 48_000, 56_000, 64_000, 80_000, 96_000, 112_000, 128_000, 160_000,
    192_000, 224_000, 256_000, 320_000, 0,
];
const BITRATE_MPEG2_L3: [u32; 16] = [
    0, 8_000, 16_000, 24_000, 32_000, 40_000, 48_000, 56_000, 64_000, 80_000, 96_000, 112_000,
    128_000, 144_000, 160_000, 0,
];
const SAMPLE_RATE_MPEG1: [u32; 4] = [44_100, 48_000, 32_000, 0];
const SAMPLE_RATE_MPEG2: [u32; 4] = [22_050, 24_000, 16_000, 0];
const SAMPLE_RATE_MPEG25: [u32; 4] = [11_025, 12_000, 8_000, 0];

#[derive(Clone, Copy)]
struct Mp3Frame {
    size: usize,
    samples: u32,
    sample_rate: u32,
}

/// Playback length of an MP3 bitstream, including Info/padding frames.
///
/// Returns `None` when no valid Layer III frames are found.
pub fn playback_duration_seconds(mp3: &[u8]) -> Option<f64> {
    let mut offset = skip_id3v2(mp3);
    let mut total_samples: u64 = 0;
    let mut sample_rate: u32 = 0;

    while offset + 4 <= mp3.len() {
        match parse_layer3_frame(&mp3[offset..]) {
            Some(frame) => {
                if sample_rate == 0 {
                    sample_rate = frame.sample_rate;
                }
                total_samples += u64::from(frame.samples);
                offset += frame.size.max(1);
            }
            None => {
                offset += 1;
            }
        }
    }

    if sample_rate == 0 || total_samples == 0 {
        return None;
    }
    Some(total_samples as f64 / f64::from(sample_rate))
}

fn skip_id3v2(data: &[u8]) -> usize {
    if data.len() < 10 || &data[0..3] != b"ID3" {
        return 0;
    }
    let size = ((u32::from(data[6]) & 0x7F) << 21)
        | ((u32::from(data[7]) & 0x7F) << 14)
        | ((u32::from(data[8]) & 0x7F) << 7)
        | (u32::from(data[9]) & 0x7F);
    let footer = if data[5] & 0x10 != 0 { 10 } else { 0 };
    (10 + size as usize + footer).min(data.len())
}

fn parse_layer3_frame(data: &[u8]) -> Option<Mp3Frame> {
    if data.len() < 4 {
        return None;
    }
    if data[0] != 0xFF || data[1] & 0xE0 != 0xE0 {
        return None;
    }

    let version_id = (data[1] >> 3) & 0x03;
    let layer = (data[1] >> 1) & 0x03;
    if layer != 0x01 {
        return None;
    }

    let bitrate_index = (data[2] >> 4) & 0x0F;
    let sample_rate_index = (data[2] >> 2) & 0x03;
    let padding = (data[2] >> 1) & 0x01;

    let (sample_rate, bitrate, samples, size_coeff) = match version_id {
        0b11 => (
            SAMPLE_RATE_MPEG1[sample_rate_index as usize],
            BITRATE_MPEG1_L3[bitrate_index as usize],
            1152u32,
            144u64,
        ),
        0b10 => (
            SAMPLE_RATE_MPEG2[sample_rate_index as usize],
            BITRATE_MPEG2_L3[bitrate_index as usize],
            576u32,
            72u64,
        ),
        0b00 => (
            SAMPLE_RATE_MPEG25[sample_rate_index as usize],
            BITRATE_MPEG2_L3[bitrate_index as usize],
            576u32,
            72u64,
        ),
        _ => return None,
    };

    if sample_rate == 0 || bitrate == 0 {
        return None;
    }

    let size = (size_coeff * u64::from(bitrate) / u64::from(sample_rate)) as usize + padding as usize;
    if size < 4 || size > data.len() {
        return None;
    }

    Some(Mp3Frame {
        size,
        samples,
        sample_rate,
    })
}

#[cfg(test)]
pub(crate) fn silent_mpeg1_layer3_cbr128_frame() -> Vec<u8> {
    // MPEG-1 Layer III, 128 kbps, 44100 Hz, no padding, mono.
    let header = [0xFF, 0xFB, 0x90, 0xC4];
    let size = (144u64 * 128_000 / 44_100) as usize;
    let mut frame = vec![0u8; size];
    frame[..4].copy_from_slice(&header);
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_is_none_for_empty_or_garbage() {
        assert_eq!(playback_duration_seconds(&[]), None);
        assert_eq!(playback_duration_seconds(&[1, 2, 3, 4, 5]), None);
    }

    #[test]
    fn counts_mpeg1_layer3_frame_duration() {
        let frame = silent_mpeg1_layer3_cbr128_frame();
        let duration = playback_duration_seconds(&frame).expect("frame");
        assert!((duration - 1152.0 / 44_100.0).abs() < 1e-9);
    }

    #[test]
    fn concatenated_frames_sum_duration() {
        let mut concat = silent_mpeg1_layer3_cbr128_frame();
        concat.extend_from_slice(&silent_mpeg1_layer3_cbr128_frame());
        let duration = playback_duration_seconds(&concat).expect("frames");
        assert!((duration - 2.0 * 1152.0 / 44_100.0).abs() < 1e-9);
    }

    #[test]
    fn skips_id3v2_header_before_frames() {
        let frame = silent_mpeg1_layer3_cbr128_frame();
        let mut tagged = b"ID3".to_vec();
        tagged.extend_from_slice(&[0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0A]);
        tagged.extend_from_slice(&[0u8; 10]);
        tagged.extend_from_slice(&frame);
        let duration = playback_duration_seconds(&tagged).expect("frame after id3");
        assert!((duration - 1152.0 / 44_100.0).abs() < 1e-9);
    }
}
