use base64::{engine::general_purpose::STANDARD, Engine as _};
use hound::{SampleFormat, WavSpec, WavWriter};
use rodio::{Decoder, Source};
use std::collections::HashMap;
use std::fs::File;
use std::io::Cursor;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Sound {
    key: String,
    data: String, // Base64-encoded audio data
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Timestamp {
    sound: String,
    time: f64,   // Time in seconds after stream start
    volume: f32, // Volume level (0.0 - 1.0)
}

pub fn mix_audio(
    sounds: Vec<Sound>,
    timestamps: Vec<Timestamp>,
    length: f64,
    output_path: String,
) -> Result<(), String> {
    // Decoding sounds
    let mut sound_map: HashMap<String, Vec<u8>> = HashMap::new();

    for sound in sounds {
        let decoded_data = match STANDARD.decode(&sound.data) {
            Ok(data) => data,
            Err(e) => {
                return Err(format!(
                    "Error decoding sound data for {}: {}",
                    sound.key, e
                ))
            }
        };
        sound_map.insert(sound.key, decoded_data);
    }

    let spec = WavSpec {
        channels: 2,         // Stereo output
        sample_rate: 44100,  // Standard audio sample rate
        bits_per_sample: 16, // 16-bit audio
        sample_format: SampleFormat::Int,
    };

    let output_file = File::create(output_path.clone()).map_err(|e| e.to_string())?;
    let mut writer = WavWriter::new(output_file, spec).map_err(|e| e.to_string())?;

    // Initialize a vector to store combined audio samples
    let mut combined_samples = vec![0i16; (length * spec.sample_rate as f64) as usize * 2];

    // Process each timestamp to mix audio
    for timestamp in timestamps {
        let sound_data = match sound_map.get(&timestamp.sound) {
            Some(data) => data.clone(),
            None => return Err(format!("Sound {} not found in sound list", timestamp.sound)),
        };

        // Decode the base64-encoded sound data
        let cursor = Cursor::new(sound_data);
        let source = match Decoder::new(cursor) {
            Ok(source) => source,
            Err(e) => {
                return Err(format!(
                    "Error decoding audio for {}: {}",
                    timestamp.sound, e
                ))
            }
        };

        let adjusted_source = source.amplify(timestamp.volume);

        let position_begin = (timestamp.time * spec.sample_rate as f64).round() as usize * 2;

        // Convert to i16 samples and apply timestamp-based mixing
        for (i, sample) in adjusted_source.enumerate() {
            let position = position_begin + i;

            if position < combined_samples.len() {
                combined_samples[position] = combined_samples[position].saturating_add(sample);
            }
        }
    }

    // Write the combined samples into the WAV file
    for sample in combined_samples {
        writer.write_sample(sample).map_err(|e| e.to_string())?;
    }

    Ok(())
}
