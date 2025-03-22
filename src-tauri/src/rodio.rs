use base64::{engine::general_purpose::STANDARD, Engine as _};
use hound::{SampleFormat, WavSpec};
use rodio::Decoder;
use tempfile::NamedTempFile;
use std::process::Command;
use std::{collections::HashMap, process::Stdio};
use std::io::{BufWriter, Cursor, Write};
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
    music_file: String,
    music_volume: f32,
    sounds: Vec<Sound>,
    timestamps: Vec<Timestamp>,
    length: f64,
    bitrate: String,
    video_file: String,
    render_output: String,
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
                sample_rate: 48000,  // Standard audio sample rate
                bits_per_sample: 32, // 32-bit audio
                sample_format: SampleFormat::Float,
            };

            // Initialize a vector to store combined audio samples
            let mut combined_samples =
                vec![0.0f32; (length * spec.sample_rate as f64) as usize * 2];

            // Process each timestamp to mix audio
            let mut decoded_sound_map: HashMap<String, Vec<f32>> = HashMap::new();

            for (key, sound_data) in sound_map.iter() {
                let cursor = Cursor::new(sound_data.clone());
                let source = match Decoder::new(cursor) {
                    Ok(source) => source,
                    Err(e) => {
                        return Err(format!("Error decoding audio for {}: {}", key, e))
                    }
                };

                let decoded_samples: Vec<f32> = source
                    .map(|sample| sample as f32 / i16::MAX as f32) // i16 to f32
                    .collect();
                decoded_sound_map.insert(key.clone(), decoded_samples);
            }

            for timestamp in timestamps {
                let sound_samples = match decoded_sound_map.get(&timestamp.sound) {
                    Some(samples) => samples,
                    None => {
                        return Err(format!("Sound {} not found in decoded sound list", timestamp.sound))
                    }
                };

                let position_begin = (timestamp.time * spec.sample_rate as f64).round() as usize * 2;

                for (i, sample) in sound_samples.iter().enumerate() {
                    let position = position_begin + i;
                    if position < combined_samples.len() {
                        combined_samples[position] += sample * timestamp.volume;
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
            let audio_output = NamedTempFile::new().map_err(|e| e.to_string())?;

            let mut proc = Command::new("ffmpeg")
                .args(format!("-y -f f32le -ar 48000 -ac 2 -i - -c:a pcm_f32le -f wav").split_whitespace())
                .arg(audio_output.path())
                .stdin(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| e.to_string())?;
            let input = proc.stdin.as_mut().unwrap();
            let mut writer = BufWriter::new(input);
            for sample in combined_samples.into_iter() {
                let _ = writer.write_all(&sample.to_le_bytes());
            }
            drop(writer);
            let _ = proc.wait();

            let filter_complex = format!(
                "[1:a]adelay=1000|1000,volume={}[a2];[2:a][a2]amix=inputs=2,alimiter=limit=1.0:level=false:attack=0.1:release=1[a]",
                music_volume
            );
            let mut proc = Command::new("ffmpeg")
                .args(format!("-y -i {} -i {} -i", video_file, music_file).split_whitespace())
                .arg(audio_output.path())
                .args(format!("-filter_complex {} -map 0:v:0 -map [a] -b:a {}k -c:a aac -c:v copy -movflags +faststart", filter_complex, bitrate).split_whitespace())
                .arg(&render_output)
                .stdin(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| e.to_string())?;
            let _ = proc.wait();

            app.emit("stream-combination-finished", &render_output).unwrap();
            Ok(())
        };
        app.emit("audio-mixing-finished", run()).unwrap();
    });

    Ok(())
}
