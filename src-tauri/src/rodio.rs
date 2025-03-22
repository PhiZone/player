use base64::{engine::general_purpose::STANDARD, Engine as _};
use hound::{SampleFormat, WavSpec, WavWriter};
use rodio::Decoder;
use std::collections::HashMap;
use std::fs::File;
use std::io::Cursor;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Sound {
    key: String,
    data: String, // Base64-encoded audio data or path to audio file
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Timestamp {
    sound: String,
    time: f64,   // Time in seconds after stream start
    volume: f32, // Volume level (0.0 - 1.0)
}

pub fn mix_audio(
    app: AppHandle,
    sounds: Vec<Sound>,
    timestamps: Vec<Timestamp>,
    length: f64,
    output_path: String,
) -> Result<(), String> {
    std::thread::spawn(move || {
        let run = || {
            // Decoding sounds
            let mut sound_map: HashMap<String, Vec<u8>> = HashMap::new();

            for sound in sounds {
                let decoded_data =
                    if sound.data.starts_with("data:") || sound.data.contains(";base64,") {
                        // Handle base64 data
                        let base64_data = sound.data.split(",").last().unwrap_or(&sound.data);
                        match STANDARD.decode(base64_data) {
                            Ok(data) => data,
                            Err(e) => {
                                return Err(format!(
                                    "Error decoding base64 sound data for {}: {}",
                                    sound.key, e
                                ))
                            }
                        }
                    } else {
                        // Handle file path
                        match std::fs::read(&sound.data) {
                            Ok(data) => data,
                            Err(e) => {
                                return Err(format!(
                                    "Error reading sound file {} for {}: {}",
                                    sound.data, sound.key, e
                                ))
                            }
                        }
                    };
                sound_map.insert(sound.key, decoded_data);
            }

            let spec = WavSpec {
                channels: 2,         // Stereo output
                sample_rate: 44100,  // Standard audio sample rate
                bits_per_sample: 32, // 32-bit audio
                sample_format: SampleFormat::Float,
            };

            let output_file = File::create(output_path.clone()).map_err(|e| e.to_string())?;
            let mut writer = WavWriter::new(output_file, spec).map_err(|e| e.to_string())?;

            // Initialize a vector to store combined audio samples
            let mut combined_samples =
                vec![0.0f32; (length * spec.sample_rate as f64) as usize * 2];

            // Process each timestamp to mix audio
            for timestamp in timestamps {
                let sound_data = match sound_map.get(&timestamp.sound) {
                    Some(data) => data.clone(),
                    None => {
                        return Err(format!("Sound {} not found in sound list", timestamp.sound))
                    }
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

                let position_begin =
                    (timestamp.time * spec.sample_rate as f64).round() as usize * 2;

                // Convert samples and apply timestamp-based mixing
                for (i, sample) in source.enumerate() {
                    let position = position_begin + i;
                    if position < combined_samples.len() {
                        // Convert i16 to f32 by dividing by i16::MAX as f32, then apply volume
                        combined_samples[position] +=
                            (sample as f32 / i16::MAX as f32) * timestamp.volume;
                    }
                }
            }

            // Normalize amplitude
            // let max_amplitude = combined_samples
            //     .iter()
            //     .map(|&x| x.abs())
            //     .max_by(|a, b| a.partial_cmp(b).unwrap())
            //     .unwrap();

            // if max_amplitude > 1.0 {
            //     for sample in &mut combined_samples {
            //         *sample /= max_amplitude;
            //     }
            // }

            // Write the combined samples into the WAV file
            for sample in combined_samples {
                writer.write_sample(sample).map_err(|e| e.to_string())?;
            }

            Ok(())
        };
        app.emit("audio-mixing-finished", run()).unwrap();
    });

    Ok(())
}
