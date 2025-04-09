use futures::{SinkExt, StreamExt};
#[cfg(unix)]
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::process::{ChildStdin, Command};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

static FFMPEG_CMD: LazyLock<Mutex<String>> = LazyLock::new(|| Mutex::new("ffmpeg".to_string()));
static FFMPEG_STDIN: LazyLock<Mutex<Option<ChildStdin>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, serde::Serialize)]
pub struct Encoder {
    name: String,
    #[serde(rename = "displayName")]
    display_name: String,
    codec: Option<String>,
}

pub fn set_ffmpeg_path(path: &str) -> Result<(), String> {
    // First check if the default ffmpeg works
    let default_result = Command::new("ffmpeg").arg("-version").output();

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
    let result = Command::new(path)
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
    let output = Command::new(&*FFMPEG_CMD.lock().unwrap())
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
    std::thread::spawn({
        let app = app.clone();
        move || {
            let _ = Command::new(&*FFMPEG_CMD.lock().unwrap())
                .args(
                    format!("-i {} -ar 44100 -c:a pcm_f32le -y {}", input, output)
                        .split_whitespace(),
                )
                .status()
                .map_err(|e| e.to_string());

            app.emit("audio-conversion-finished", ()).unwrap();
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
    std::thread::spawn({
        let app = app.clone();
        move || {
            let filter_complex = format!(
                "[1:a]adelay=1000|1000,volume={}[a2];[2:a][a2]amix=inputs=2:normalize=0,alimiter=limit=1.0:level=false:attack=0.1:release=1[a]",
                music_volume
            );
            let _ = Command::new(&*FFMPEG_CMD.lock().unwrap())
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

            app.emit("stream-combination-finished", &output).unwrap();
        }
    });

    Ok(())
}

pub async fn setup_video(
    output: String,
    resolution: String,
    framerate: u32,
    codec: String,
    bitrate: String,
) -> Result<(), String> {
    let process = Command::new(&*FFMPEG_CMD.lock().unwrap())
        .args(format!(
            "-probesize 50M -f rawvideo -pix_fmt rgb24 -s {} -r {} -thread_queue_size 1024 -i pipe:0 -c:v {} -b:v {} -vf vflip -pix_fmt yuv420p -y {}",
            resolution, framerate.to_string(), codec, bitrate, output
        )
        .split_whitespace())
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    *FFMPEG_STDIN.lock().unwrap() = process.stdin;

    let listener = TcpListener::bind("127.0.0.1:63401")
        .await
        .map_err(|e| e.to_string())?;

    let mut frames_received = 0;

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let ws_stream = match accept_async(stream).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("WebSocket handshake failed: {}", e);
                    continue;
                }
            };
            let (mut write, mut read) = ws_stream.split();

            while let Some(Ok(message)) =
                tokio::time::timeout(std::time::Duration::from_secs(60), read.next())
                    .await
                    .unwrap_or(None)
            {
                if message.is_binary() {
                    frames_received += 1;
                    let data = message.into_data();
                    if let Some(stdin) = &mut *FFMPEG_STDIN.lock().unwrap() {
                        if let Err(e) = stdin.write_all(&data) {
                            eprintln!("Error writing to FFmpeg: {}", e);
                            break;
                        }
                        if let Err(e) = stdin.flush() {
                            eprintln!("Error flushing FFmpeg: {}", e);
                            break;
                        }
                    } else {
                        eprintln!("FFmpeg stdin not available");
                        break;
                    }
                } else if message.is_text() {
                    let text = message.to_text().unwrap();
                    if text == "finish" {
                        write.send("finished".into()).await.unwrap();
                        finish_video().unwrap();
                        return;
                    } else if text == "pause" {
                        write
                            .send(frames_received.to_string().into())
                            .await
                            .unwrap();
                    }
                }
            }
            println!("Connection closed due to inactivity or end of stream");
            finish_video().unwrap();
            return;
        }
    });

    Ok(())
}

pub fn finish_video() -> Result<(), String> {
    let mut guard = FFMPEG_STDIN.lock().unwrap();
    if let Some(stdin) = guard.take() {
        drop(stdin);
    }
    Ok(())
}
