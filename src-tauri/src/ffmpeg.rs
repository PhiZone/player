use futures::{SinkExt, StreamExt};
#[cfg(unix)]
use std::fs;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::process::{Child, ChildStdin};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use crate::cmd_hidden;
use crate::send_webhook_notification;

static FFMPEG_CMD: LazyLock<Mutex<String>> = LazyLock::new(|| Mutex::new("ffmpeg".to_string()));
static FFMPEG_STDIN: LazyLock<Mutex<Option<ChildStdin>>> = LazyLock::new(|| Mutex::new(None));
static FFMPEG_PROCESS: LazyLock<Mutex<Option<Child>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserRenderInit {
    #[serde(rename = "type")]
    kind: String,
    resolution: String,
    framerate: u32,
    codec: String,
    bitrate: String,
}

pub async fn start_browser_render_ws_server() -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:63402")
        .await
        .map_err(|e| format!("Failed to bind browser render WS server: {}", e))?;

    println!("[TAURI] Browser render WS server listening on ws://127.0.0.1:63402");

    loop {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("Failed to accept browser render WS connection: {}", e))?;

        tokio::spawn(async move {
            let ws_stream = match accept_async(stream).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[TAURI] Browser render WS handshake failed: {}", e);
                    return;
                }
            };

            let (mut write, mut read) = ws_stream.split();
            let mut stdin: Option<ChildStdin> = None;
            let mut process: Option<Child> = None;
            let mut output_path: Option<std::path::PathBuf> = None;
            let mut frames_received: u64 = 0;
            let report_interval = get_report_interval() as u64;

            while let Some(Ok(message)) = read.next().await {
                if message.is_text() {
                    let text = match message.to_text() {
                        Ok(t) => t,
                        Err(e) => {
                            let _ = write
                                .send(Message::Text(format!("error:invalid_text:{}", e).into()))
                                .await;
                            continue;
                        }
                    };

                    if text == "finish" {
                        if let Some(mut p) = process.take() {
                            drop(stdin.take());

                            match p.wait() {
                                Ok(status) if status.success() => {
                                    if let Some(path) = output_path.take() {
                                        match tokio::fs::read(&path).await {
                                            Ok(data) => {
                                                let _ = write.send(Message::Binary(data.into())).await;
                                                let _ = tokio::fs::remove_file(path).await;
                                                let _ = write.send(Message::Text("finished".into())).await;
                                            }
                                            Err(e) => {
                                                let _ = write
                                                    .send(Message::Text(
                                                        format!("error:read_output:{}", e).into(),
                                                    ))
                                                    .await;
                                            }
                                        }
                                    }
                                }
                                Ok(status) => {
                                    let _ = write
                                        .send(Message::Text(
                                            format!("error:ffmpeg_status:{}", status).into(),
                                        ))
                                        .await;
                                }
                                Err(e) => {
                                    let _ = write
                                        .send(Message::Text(
                                            format!("error:wait_process:{}", e).into(),
                                        ))
                                        .await;
                                }
                            }
                        } else {
                            let _ = write.send(Message::Text("error:not_initialized".into())).await;
                        }
                        break;
                    }

                    if text == "pause" {
                        let _ = write
                            .send(Message::Text(frames_received.to_string().into()))
                            .await;
                        continue;
                    }

                    match serde_json::from_str::<BrowserRenderInit>(text) {
                        Ok(init) if init.kind == "init" => {
                            let ts = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .map(|d| d.as_nanos())
                                .unwrap_or(0);
                            let path = std::env::temp_dir()
                                .join(format!("phizone-player-browser-render-{}.mp4", ts));

                            let mut cmd = cmd_hidden(&*FFMPEG_CMD.lock().unwrap());
                            cmd.args(
                                format!(
                                    "-probesize 50M -f rawvideo -pix_fmt rgb24 -s {} -r {} -thread_queue_size 1024 -i pipe:0 -c:v {} -b:v {} -vf vflip -pix_fmt yuv420p -movflags +faststart -y {}",
                                    init.resolution,
                                    init.framerate,
                                    init.codec,
                                    init.bitrate,
                                    path.display()
                                )
                                .split_whitespace(),
                            )
                            .stdin(std::process::Stdio::piped())
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null());

                            match cmd.spawn() {
                                Ok(mut child) => {
                                    stdin = child.stdin.take();
                                    process = Some(child);
                                    output_path = Some(path);
                                    frames_received = 0;
                                    let _ = write.send(Message::Text("ready".into())).await;
                                }
                                Err(e) => {
                                    let _ = write
                                        .send(Message::Text(
                                            format!("error:spawn_ffmpeg:{}", e).into(),
                                        ))
                                        .await;
                                }
                            }
                        }
                        _ => {
                            let _ = write.send(Message::Text("error:invalid_command".into())).await;
                        }
                    }
                    continue;
                }

                if message.is_binary() {
                    frames_received += 1;

                    if let Some(stdin_ref) = stdin.as_mut() {
                        if let Err(e) = stdin_ref.write_all(&message.into_data()) {
                            let _ = write
                                .send(Message::Text(format!("error:write_stdin:{}", e).into()))
                                .await;
                            break;
                        }

                        if report_interval > 0 && frames_received % report_interval == 0 {
                            let _ = write
                                .send(Message::Text(
                                    format!("progress:{}", frames_received).into(),
                                ))
                                .await;
                        }
                    } else {
                        let _ = write.send(Message::Text("error:not_initialized".into())).await;
                        break;
                    }
                }
            }
        });
    }
}

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
    std::thread::spawn({
        let app = app.clone();
        move || {
            let detect_cmd = cmd_hidden(&*FFMPEG_CMD.lock().unwrap())
                .args(format!("-i {} -af volumedetect -f null -", input).split_whitespace())
                .output();

            let mut gain = 0.0;
            if let Ok(output_res) = detect_cmd {
                let stderr = String::from_utf8_lossy(&output_res.stderr);
                for line in stderr.lines() {
                    if let Some(idx) = line.find("max_volume:") {
                        let vol_str = line[idx + 11..].trim();
                        if let Some(db_idx) = vol_str.find(" dB") {
                            if let Ok(vol) = vol_str[..db_idx].trim().parse::<f32>() {
                                gain = -vol;
                            }
                        }
                    }
                }
            }

            let result = cmd_hidden(&*FFMPEG_CMD.lock().unwrap())
                .args(
                    format!("-i {} -af volume={}dB -ar 48000 -c:a pcm_f32le -y {}", input, gain, output)
                        .split_whitespace(),
                )
                .status()
                .map_err(|e| e.to_string());

            match result {
                Ok(_) => {
                    app.emit("audio-conversion-finished", ()).unwrap();
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
    send_webhook_notification("combining_streams", 0.0, None);
    
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
        let mut start_time: Option<std::time::Instant> = None;
        
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

                    // Start timer when we receive the first frame
                    if start_time.is_none() {
                        start_time = Some(std::time::Instant::now());
                    }

                    if frames_received % report_interval as u64 == 0 {
                        let progress_percent = if total_frames > 0 {
                            (frames_received as f64 / total_frames as f64) * 100.0
                        } else {
                            0.0
                        };
                        
                        // Calculate ETA
                        let eta_seconds = if let Some(start) = start_time {
                            let elapsed = start.elapsed().as_secs_f64();
                            let progress_ratio = frames_received as f64 / total_frames as f64;
                            
                            if progress_ratio > 0.0 && frames_received >= report_interval as u64 {
                                // ETA = (elapsed_time / progress_ratio) - elapsed_time
                                let total_estimated_time = elapsed / progress_ratio;
                                let remaining_time = total_estimated_time - elapsed;
                                Some(remaining_time.max(0.0)) // Ensure non-negative
                            } else {
                                None // Not enough data for reliable estimate
                            }
                        } else {
                            None
                        };
                        
                        let total_digits = total_frames.to_string().len();
                        if let Some(eta) = eta_seconds {
                            let eta_mins = (eta / 60.0) as u32;
                            let eta_secs = (eta % 60.0) as u32;
                            print!(
                                "\r[TAURI] Rendering: {:6.2}% ({:width$}/{}) ETA: {:02}:{:02} ... ",
                                progress_percent,
                                frames_received,
                                total_frames,
                                eta_mins,
                                eta_secs,
                                width = total_digits
                            );
                        } else {
                            print!(
                                "\r[TAURI] Rendering: {:6.2}% ({:width$}/{}) ... ",
                                progress_percent,
                                frames_received,
                                total_frames,
                                width = total_digits
                            );
                        }
                        std::io::stdout().flush().unwrap();
                        send_webhook_notification("rendering", progress_percent / 100.0, eta_seconds);
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
