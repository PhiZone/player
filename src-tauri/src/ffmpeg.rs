use futures::{SinkExt, StreamExt};
use std::io::Write;
use std::process::{ChildStdin, Command};
use std::sync::{LazyLock, Mutex};
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

static FFMPEG_STDIN: LazyLock<Mutex<Option<ChildStdin>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, serde::Serialize)]
pub struct Encoder {
    name: String,
    #[serde(rename = "displayName")]
    display_name: String,
    codec: Option<String>,
}

pub fn get_encoders() -> Result<Vec<Encoder>, String> {
    let output = Command::new("ffmpeg")
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

pub fn png_sequence_to_video(
    input: String,
    output: String,
    resolution: String,
    fps: u32,
    codec: String,
) -> Result<(), String> {
    let fps_str = fps.to_string();
    let args = vec![
        "-f",
        "image2",
        "-r",
        &fps_str,
        "-i",
        &input,
        "-s",
        &resolution,
        "-r",
        &fps_str,
        "-c:v",
        &codec,
        "-pixel_format",
        "yuv420p",
        "-y",
        &output,
    ];

    let process = Command::new("ffmpeg")
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    *FFMPEG_STDIN.lock().unwrap() = process.stdin;

    Ok(())
}

pub async fn setup_video(
    output: String,
    resolution: String,
    framerate: u32,
    codec: String,
    bitrate: String,
) -> Result<(), String> {
    let framerate_str = framerate.to_string();
    let args = vec![
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        &resolution,
        "-r",
        &framerate_str,
        "-i",
        "pipe:0",
        "-c:v",
        &codec,
        "-b:v",
        &bitrate,
        "-vf",
        "vflip",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        &output,
    ];

    let process = Command::new("ffmpeg")
        .args(&args)
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

            while let Some(Ok(message)) = read.next().await {
                if message.is_binary() {
                    frames_received += 1;
                    println!("BIN {} {:?}", frames_received, std::time::SystemTime::now());
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
                        println!("FIN {} {:?}", frames_received, std::time::SystemTime::now());
                        let mut guard = FFMPEG_STDIN.lock().unwrap();
                        if let Some(stdin) = guard.take() {
                            drop(stdin); // This closes the stdin pipe
                        }
                        return; // Exit the task completely
                    } else if text == "pause" {
                        println!("PAU {} {:?}", frames_received, std::time::SystemTime::now());
                        write
                            .send(frames_received.to_string().into())
                            .await
                            .unwrap();
                    }
                }
            }
        }
    });

    Ok(())
}

pub fn receive_frame(frame: Vec<u8>) -> Result<(), String> {
    if let Some(stdin) = &mut *FFMPEG_STDIN.lock().unwrap() {
        stdin.write_all(&frame).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    } else {
        return Err("FFmpeg stdin is not available".into());
    }
    Ok(())
}

pub fn finish_video() -> Result<(), String> {
    let mut guard = FFMPEG_STDIN.lock().unwrap();
    if let Some(stdin) = guard.take() {
        drop(stdin); // This closes the stdin pipe
    }
    Ok(())
}
