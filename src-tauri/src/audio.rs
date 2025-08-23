use base64::{engine::general_purpose::STANDARD, Engine as _};
use hound::{SampleFormat, WavSpec};
use rodio::Decoder;
use std::io::{BufWriter, Cursor, Write};
use std::{collections::HashMap, process::Stdio};
use tauri::{AppHandle, Emitter};

use crate::cmd_hidden;
use crate::send_webhook_notification;

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
    #[serde(default = "default_rate")]
    rate: f32, // Playback rate (1.0 is normal speed)
}

fn default_rate() -> f32 {
    1.0
}

pub fn mix_audio(
    app: AppHandle,
    sounds: Vec<Sound>,
    timestamps: Vec<Timestamp>,
    length: f64,
    output: String,
) -> Result<(), String> {
    send_webhook_notification("mixing_audio", 0.0, None);
    
    std::thread::spawn(move || {
        let mix_result = (|| -> Result<(), String> {
            print!("[TAURI] Mixing audio...");

            // Decoding sounds
            let mut decoded_sound_map: HashMap<String, Vec<f32>> = HashMap::new();

            for sound in sounds {
                let sound_data =
                    if sound.data.starts_with("data:") || sound.data.contains(";base64,") {
                        let base64_data = sound.data.split(",").last().unwrap_or(&sound.data);
                        STANDARD.decode(base64_data).map_err(|e| {
                            format!("Error decoding base64 sound data for {}: {}", sound.key, e)
                        })?
                    } else {
                        std::fs::read(&sound.data).map_err(|e| {
                            format!(
                                "Error reading sound file {} for {}: {}",
                                sound.data, sound.key, e
                            )
                        })?
                    };

                let cursor = Cursor::new(sound_data);
                let source = Decoder::new(cursor)
                    .map_err(|e| format!("Error decoding audio for {}: {}", sound.key, e))?;

                let decoded_samples: Vec<f32> = source
                    .map(|sample| sample as f32 / i16::MAX as f32) // i16 -> f32
                    .collect();
                decoded_sound_map.insert(sound.key.clone(), decoded_samples);
            }

            let spec = WavSpec {
                channels: 2,         // Stereo output
                sample_rate: 44100,  // Standard audio sample rate
                bits_per_sample: 32, // 32-bit audio
                sample_format: SampleFormat::Float,
            };

            // Initialize a vector to store combined audio samples
            let mut combined_samples =
                vec![0.0f32; (length * spec.sample_rate as f64) as usize * 2];

            // Process each timestamp to mix audio

            for timestamp in timestamps {
                let sound_samples = match decoded_sound_map.get(&timestamp.sound) {
                    Some(samples) => samples,
                    None => {
                        return Err(format!(
                            "Sound {} not found in decoded sound list",
                            timestamp.sound
                        ))
                    }
                };

                let position_begin =
                    (timestamp.time * spec.sample_rate as f64).round() as usize * 2;

                // Handle playback rate
                if timestamp.rate == 1.0 {
                    // Normal playback rate, no interpolation needed
                    for (i, sample) in sound_samples.iter().enumerate() {
                        let slice = &mut combined_samples[position_begin..];
                        if i >= slice.len() {
                            break;
                        }
                        slice[i] += sample * timestamp.volume;
                    }
                } else {
                    // Adjusted playback rate using linear interpolation
                    let sample_count = sound_samples.len();
                    let mut source_idx: f32 = 0.0;

                    let mut i = 0;
                    while source_idx < sample_count as f32
                        && i < combined_samples.len() - position_begin
                    {
                        let source_idx_floor = source_idx.floor() as usize;
                        let source_idx_ceil = source_idx.ceil() as usize;

                        if source_idx_ceil >= sample_count {
                            break;
                        }

                        let frac = source_idx - source_idx_floor as f32;
                        let sample = if source_idx_floor == source_idx_ceil {
                            sound_samples[source_idx_floor]
                        } else {
                            // Linear interpolation between adjacent samples
                            let s1 = sound_samples[source_idx_floor];
                            let s2 = sound_samples[source_idx_ceil];
                            s1 * (1.0 - frac) + s2 * frac
                        };

                        let output_idx = position_begin + i;
                        if output_idx < combined_samples.len() {
                            combined_samples[output_idx] += sample * timestamp.volume;
                        }

                        i += 1;
                        source_idx += timestamp.rate;
                    }
                }
            }

            let mut proc = cmd_hidden("ffmpeg")
                .args(
                    format!("-y -f f32le -ar 44100 -ac 2 -i - -c:a pcm_f32le -f wav")
                        .split_whitespace(),
                )
                .arg(output)
                .stdin(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| e.to_string())?;
            let input = proc.stdin.as_mut().unwrap();
            let mut writer = BufWriter::new(input);
            for sample in combined_samples.into_iter() {
                writer
                    .write_all(&sample.to_le_bytes())
                    .map_err(|e| e.to_string())?;
            }
            drop(writer);
            if proc.wait().map_err(|e| e.to_string())?.success() {
                app.emit("audio-mixing-finished", ()).unwrap();
                println!(" finished.");
                Ok(())
            } else {
                Err("FFmpeg process failed".to_string())
            }
        })();

        if let Err(e) = mix_result {
            eprintln!("[TAURI] Audio mixing failed: {}", e);
        }
    });

    Ok(())
}
