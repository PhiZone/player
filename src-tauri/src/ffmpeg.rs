use futures::{SinkExt, StreamExt};
#[cfg(unix)]
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::process::{Child, ChildStdin};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

use crate::cmd_hidden;
use crate::send_webhook_notification;

static FFMPEG_CMD: LazyLock<Mutex<String>> = LazyLock::new(|| Mutex::new("ffmpeg".to_string()));
static FFMPEG_STDIN: LazyLock<Mutex<Option<ChildStdin>>> = LazyLock::new(|| Mutex::new(None));
static FFMPEG_PROCESS: LazyLock<Mutex<Option<Child>>> = LazyLock::new(|| Mutex::new(None));

fn get_report_interval() -> u32 {
    match std::env::var("REPORT_INTERVAL") {
        Ok(val) => val.parse::<u32>().unwrap_or(1).max(1),
        Err(_) => 1,
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Encoder {
    name: String,
    #[serde(rename = "displayName")]
    display_name: String,
    codec: Option<String>,
}

pub fn set_ffmpeg_path(path: &str) -> Result<(), String> {
    // First check if the default ffmpeg works
    let default_result = cmd_hidden("ffmpeg").arg("-version").output();

    // If default works and we're not forcing a new path, keep using default
    if default_result.is_ok() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        // Check if the executable at the provided path has executable permissions, and if not, grant them
        let metadata =
            fs::metadata(path).map_err(|e| format!("Failed to access file metadata: {}", e))?;
        let mut permissions = metadata.permissions();

        if (permissions.mode() & 0o111) == 0 {
            permissions.set_mode(permissions.mode() | 0o111);
            fs::set_permissions(path, permissions)
                .map_err(|e| format!("Failed to set executable permissions: {}", e))?;
        }
    }

    // Test the provided path
    let result = cmd_hidden(path)
        .arg("-version")
        .output()
        .map_err(|e| format!("Failed to execute FFmpeg at path '{}': {}", path, e))?;

    if !result.status.success() {
        return Err(format!(
            "FFmpeg at '{}' executed but returned error code",
            path
        ));
    }

    // Update the path if the test succeeded
    let mut cmd = FFMPEG_CMD.lock().unwrap();
    *cmd = path.to_string();
    Ok(())
}

pub fn get_encoders() -> Result<Vec<Encoder>, String> {
    let output = cmd_hidden(&*FFMPEG_CMD.lock().unwrap())
        .arg("-encoders")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("FFmpeg command failed".to_string());
    }

    let output_str = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;

    let mut encoders = Vec::new();
    let mut in_encoder_section = false;

    for line in output_str.lines() {
        if line.ends_with("------") {
            in_encoder_section = true;
            continue;
        }

        if in_encoder_section && !line.is_empty() {
            if let Some(info) = line.get(8..) {
                let parts: Vec<&str> = info.splitn(2, ' ').collect();
                if parts.len() == 2 {
                    let name = parts[0].trim().to_string();
                    let desc = parts[1].trim();

                    let codec = if let Some(start) = desc.rfind("(codec ") {
                        if let Some(end) = desc[start..].find(")") {
                            Some(desc[start + 7..start + end].to_string())
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let display_name = if let Some(start) = desc.rfind("(codec ") {
                        desc[..start].trim().to_string()
                    } else {
                        desc.to_string()
                    };

                    encoders.push(Encoder {
                        name,
                        display_name,
                        codec,
                    });
                }
            }
        }
    }

    Ok(encoders)
}

pub fn convert_audio(app: AppHandle, input: String, output: String) -> Result<(), String> {
    send_webhook_notification("converting_audio", 0.0);
    
    std::thread::spawn({
        let app = app.clone();
        move || {
            print!("[TAURI] Converting audio...");
            let result = cmd_hidden(&*FFMPEG_CMD.lock().unwrap())
                .args(
                    format!("-i {} -ar 44100 -c:a pcm_f32le -y {}", input, output)
                        .split_whitespace(),
                )
                .status()
                .map_err(|e| e.to_string());

            match result {
                Ok(_) => {
                    app.emit("audio-conversion-finished", ()).unwrap();
                    println!(" finished.");
                    send_webhook_notification("converting_audio", 1.0);
                }
                Err(e) => {
                    eprintln!("[TAURI] Audio conversion failed: {}", e);
                }
            }
        }
    });

    Ok(())
}

pub fn combine_streams(
    app: AppHandle,
    input_video: String,
    input_music: String,
    input_hitsounds: String,
    music_volume: f32,
    audio_bitrate: String,
    output: String,
) -> Result<(), String> {
    send_webhook_notification("combining_streams", 0.0);
    
    std::thread::spawn({
        let app = app.clone();
        move || {
            print!("[TAURI] Combining streams...");
            let filter_complex = format!(
                "[1:a]adelay=1000|1000,volume={}[a2];[2:a][a2]amix=inputs=2:normalize=0,alimiter=limit=1.0:level=false:attack=0.1:release=1[a]",
                music_volume
            );
            let result = cmd_hidden(&*FFMPEG_CMD.lock().unwrap())
                .args(
                    format!(
                        "-y -i {} -i {} -i {} -filter_complex {}",
                        input_video, input_music, input_hitsounds, filter_complex
                    )
                    .split_whitespace(),
                )
                .args(
                    format!(
                        "-map 0:v:0 -map [a] -b:a {} -c:a aac -c:v copy -movflags +faststart",
                        audio_bitrate
                    )
                    .split_whitespace(),
                )
                .arg(&output)
                .status()
                .map_err(|e| e.to_string());

            match result {
                Ok(_) => {
                    app.emit("stream-combination-finished", &output).unwrap();
                    println!(" finished.");
                    send_webhook_notification("combining_streams", 1.0);
                }
                Err(e) => {
                    eprintln!("[TAURI] Stream combination failed: {}", e);
                }
            }
        }
    });

    Ok(())
}

pub async fn setup_video(
    output: String,
    resolution: String,
    framerate: u32,
    duration: f64,
    codec: String,
    bitrate: String,
) -> Result<(), String> {
    let mut process = cmd_hidden(&*FFMPEG_CMD.lock().unwrap())
        .args(format!(
            "-probesize 50M -f rawvideo -pix_fmt rgb24 -s {} -r {} -thread_queue_size 1024 -i pipe:0 -c:v {} -b:v {} -vf vflip -pix_fmt yuv420p -movflags +faststart -y {}",
            resolution, framerate.to_string(), codec, bitrate, output
        )
        .split_whitespace())
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdin = process.stdin.take();
    *FFMPEG_STDIN.lock().unwrap() = stdin;
    *FFMPEG_PROCESS.lock().unwrap() = Some(process);

    let listener = TcpListener::bind("127.0.0.1:63401")
        .await
        .map_err(|e| e.to_string())?;

    let mut frames_received = 0;
    let total_frames = (duration * framerate as f64).ceil() as u64;
    let report_interval = get_report_interval();
    println!("[TAURI] FFmpeg setup complete");

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let ws_stream = match accept_async(stream).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[TAURI] WebSocket handshake failed: {}", e);
                    continue;
                }
            };
            println!("[TAURI] WebSocket connection established");
            let (mut write, mut read) = ws_stream.split();

            while let Some(Ok(message)) =
                tokio::time::timeout(std::time::Duration::from_secs(60), read.next())
                    .await
                    .unwrap_or(None)
            {
                if message.is_binary() {
                    frames_received += 1;
                    let data = message.into_data();

                    if frames_received % report_interval as u64 == 0 {
                        let progress_percent = if total_frames > 0 {
                            (frames_received as f64 / total_frames as f64) * 100.0
                        } else {
                            0.0
                        };
                        let total_digits = total_frames.to_string().len();
                        print!(
                            "\r[TAURI] Rendering: {:6.2}% ({:width$}/{}) ... ",
                            progress_percent,
                            frames_received,
                            total_frames,
                            width = total_digits
                        );
                        std::io::stdout().flush().unwrap();
                        send_webhook_notification("rendering", progress_percent / 100.0);
                    }

                    if let Some(stdin) = &mut *FFMPEG_STDIN.lock().unwrap() {
                        if let Err(e) = stdin.write_all(&data) {
                            println!();
                            eprintln!("[TAURI] Error writing to FFmpeg: {}", e);
                            break;
                        }
                        if let Err(e) = stdin.flush() {
                            println!();
                            eprintln!("[TAURI] Error flushing FFmpeg: {}", e);
                            break;
                        }
                    } else {
                        println!();
                        eprintln!("[TAURI] FFmpeg stdin not available");
                        break;
                    }
                } else if message.is_text() {
                    let text = message.to_text().unwrap();
                    if text == "finish" {
                        println!("finished.");
                        match finish_video() {
                            Ok(_) => {
                                write.send("finished".into()).await.unwrap();
                            }
                            Err(e) => {
                                eprintln!("[TAURI] Error finishing video: {}", e);
                            }
                        }
                        return;
                    } else if text == "pause" {
                        write
                            .send(frames_received.to_string().into())
                            .await
                            .unwrap();
                    }
                }
            }
            println!("[TAURI] Connection closed due to inactivity or end of stream");
            // Finish video encoding when connection closes
            if let Err(e) = finish_video() {
                eprintln!("[TAURI] Error finishing video on connection close: {}", e);
            }
            return;
        }
    });

    Ok(())
}

pub fn finish_video() -> Result<(), String> {
    // Close stdin first to signal end of input
    let mut stdin_guard = FFMPEG_STDIN.lock().unwrap();
    if let Some(stdin) = stdin_guard.take() {
        drop(stdin);
        println!("[TAURI] FFmpeg stdin closed");
    }
    drop(stdin_guard);

    // Wait for the FFmpeg process to complete
    let mut process_guard = FFMPEG_PROCESS.lock().unwrap();
    if let Some(mut process) = process_guard.take() {
        match process.wait() {
            Ok(status) => {
                if status.success() {
                    println!("[TAURI] FFmpeg process completed successfully");
                } else {
                    eprintln!("[TAURI] FFmpeg process failed with status: {}", status);
                    return Err(format!("FFmpeg process failed with status: {}", status));
                }
            }
            Err(e) => {
                eprintln!("[TAURI] Error waiting for FFmpeg process: {}", e);
                return Err(format!("Error waiting for FFmpeg process: {}", e));
            }
        }
    } else {
        println!("[TAURI] No FFmpeg process to wait for");
    }

    Ok(())
}
