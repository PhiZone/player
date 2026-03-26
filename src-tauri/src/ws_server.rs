use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures::{SinkExt, StreamExt};
use serde_json::Value;
use tauri::Manager;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, Notify};
use tokio_tungstenite::accept_async;

use crate::{audio, ffmpeg, send_webhook_notification};

/// Port for the WebSocket server used for IPC + frame transfer.
pub const WS_PORT: u16 = 63401;

// ── Global state ─────────────────────────────────────────────────────

/// Broadcast channel for forwarding events to IPC WebSocket clients.
static EVENT_TX: LazyLock<Mutex<Option<broadcast::Sender<String>>>> =
    LazyLock::new(|| Mutex::new(None));

/// Frame streaming state shared between the WS server and Tauri commands.
pub static FRAME_STATE: LazyLock<Mutex<FrameState>> =
    LazyLock::new(|| Mutex::new(FrameState::default()));

/// Stored `AppHandle` so WS command handlers can call `app.emit()` etc.
static APP_HANDLE: LazyLock<Mutex<Option<tauri::AppHandle>>> =
    LazyLock::new(|| Mutex::new(None));

/// Notified (once) when the WS server has bound to its port.
static SERVER_READY: LazyLock<Notify> = LazyLock::new(Notify::new);

/// Notified (once) when the first IPC client connects via WebSocket.
static IPC_CLIENT_CONNECTED: LazyLock<Notify> = LazyLock::new(Notify::new);

/// `true` once any IPC client has ever connected. Prevents duplicate
/// notifications on `IPC_CLIENT_CONNECTED`.
static IPC_CLIENT_SEEN: AtomicBool = AtomicBool::new(false);

/// Mutable state for frame streaming progress.
pub struct FrameState {
    pub active: bool,
    pub frames_received: u64,
    pub total_frames: u64,
    pub report_interval: u32,
    pub start_time: Option<std::time::Instant>,
}

impl Default for FrameState {
    fn default() -> Self {
        Self {
            active: false,
            frames_received: 0,
            total_frames: 0,
            report_interval: 1,
            start_time: None,
        }
    }
}

// ── Public helpers ───────────────────────────────────────────────────

/// Send an event to all connected IPC WebSocket clients.
pub fn broadcast_event(event: &str, payload: Value) {
    if let Some(tx) = EVENT_TX.lock().unwrap().as_ref() {
        let msg = serde_json::json!({
            "type": "event",
            "event": event,
            "payload": payload,
        });
        let _ = tx.send(msg.to_string());
    }
}

/// Wait until the WS server has bound to its port and is ready to accept
/// connections.
pub async fn wait_for_ready() {
    SERVER_READY.notified().await;
}

/// Wait until an IPC client has connected via WebSocket.
pub async fn wait_for_ipc_client() {
    IPC_CLIENT_CONNECTED.notified().await;
}

// ── Server entry point ──────────────────────────────────────────────

/// Start the always-on WebSocket server on port 63401.
///
/// This server handles **both** IPC invoke/event messages (JSON text)
/// **and** binary frame transfer for rendering.
pub async fn start(app_handle: tauri::AppHandle) {
    *APP_HANDLE.lock().unwrap() = Some(app_handle);

    let (event_tx, _) = broadcast::channel::<String>(256);
    *EVENT_TX.lock().unwrap() = Some(event_tx);

    let listener = match TcpListener::bind(format!("127.0.0.1:{}", WS_PORT)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[WS Server] Failed to bind to port {}: {}", WS_PORT, e);
            return;
        }
    };
    println!("[WS Server] Listening on port {}", WS_PORT);

    // Signal that the server is ready to accept connections.
    SERVER_READY.notify_one();

    while let Ok((stream, addr)) = listener.accept().await {
        tokio::spawn(async move {
            let ws_stream = match accept_async(stream).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[WS Server] Handshake failed for {}: {}", addr, e);
                    return;
                }
            };
            println!("[WS Server] Connection from {}", addr);
            handle_connection(ws_stream).await;
            println!("[WS Server] Connection from {} closed", addr);
        });
    }
}

// ── Connection handler ──────────────────────────────────────────────

async fn handle_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
) {
    let (write, mut read) = ws_stream.split();
    let write = Arc::new(tokio::sync::Mutex::new(write));

    // Track whether this connection has been identified as an IPC client.
    // Only IPC clients receive event broadcasts (to avoid confusing the
    // FrameSender worker which only expects "finished" or integer strings).
    let is_ipc = Arc::new(AtomicBool::new(false));

    // Spawn a task that forwards broadcast events to this connection.
    let event_rx = EVENT_TX
        .lock()
        .unwrap()
        .as_ref()
        .map(|tx| tx.subscribe());
    let write_for_events = write.clone();
    let is_ipc_for_events = is_ipc.clone();

    let event_task = event_rx.map(|mut rx| {
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(msg) => {
                        if is_ipc_for_events.load(Ordering::Relaxed) {
                            let mut w = write_for_events.lock().await;
                            if w.send(msg.into()).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    });

    // Track whether this connection is handling frame transfer.
    let mut is_frame_connection = false;

    // Process incoming messages.
    while let Some(msg_result) = read.next().await {
        let message = match msg_result {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[WS Server] Read error: {}", e);
                break;
            }
        };

        if message.is_close() {
            break;
        }

        if message.is_text() {
            let text = match message.to_text() {
                Ok(t) => t,
                Err(_) => continue,
            };

            // Try to parse as JSON IPC invoke message.
            if let Ok(json) = serde_json::from_str::<Value>(text) {
                if json.get("type").and_then(|t| t.as_str()) == Some("invoke") {
                    is_ipc.store(true, Ordering::Relaxed);
                    // Signal the very first IPC client connection (globally).
                    if !IPC_CLIENT_SEEN.swap(true, Ordering::Relaxed) {
                        IPC_CLIENT_CONNECTED.notify_one();
                    }
                    let response = handle_invoke(&json).await;
                    let mut w = write.lock().await;
                    let _ = w.send(response.into()).await;
                    continue;
                }
            }

            // Frame control messages (from FrameSender worker).
            if text == "finish" {
                {
                    let mut state = FRAME_STATE.lock().unwrap();
                    state.active = false;
                }
                println!("finished.");
                match ffmpeg::finish_video() {
                    Ok(_) => {
                        let mut w = write.lock().await;
                        let _ = w.send("finished".into()).await;
                    }
                    Err(e) => {
                        eprintln!("[WS Server] Error finishing video: {}", e);
                    }
                }
                is_frame_connection = false;
            } else if text == "pause" {
                let frames = FRAME_STATE.lock().unwrap().frames_received;
                let mut w = write.lock().await;
                let _ = w.send(frames.to_string().into()).await;
            }
        } else if message.is_binary() {
            // Binary data → frame data for FFmpeg.
            is_frame_connection = true;
            let data = message.into_data();
            handle_frame_data(&data);
        }
    }

    // If this was a frame connection that closed while streaming was still
    // active, finish the video to avoid leaving FFmpeg hanging.
    if is_frame_connection && FRAME_STATE.lock().unwrap().active {
        println!("[WS Server] Frame connection closed unexpectedly, finishing video");
        FRAME_STATE.lock().unwrap().active = false;
        if let Err(e) = ffmpeg::finish_video() {
            eprintln!("[WS Server] Error finishing video on connection close: {}", e);
        }
    }

    if let Some(task) = event_task {
        task.abort();
    }
}

// ── Frame handling ──────────────────────────────────────────────────

fn handle_frame_data(data: &[u8]) {
    let (frames_received, total_frames, report_interval, start_time, active) = {
        let mut state = FRAME_STATE.lock().unwrap();
        if !state.active {
            return;
        }
        state.frames_received += 1;
        if state.start_time.is_none() {
            state.start_time = Some(std::time::Instant::now());
        }
        (
            state.frames_received,
            state.total_frames,
            state.report_interval,
            state.start_time,
            state.active,
        )
    };

    if !active {
        return;
    }

    // Progress reporting
    if frames_received % report_interval as u64 == 0 {
        let progress_percent = if total_frames > 0 {
            (frames_received as f64 / total_frames as f64) * 100.0
        } else {
            0.0
        };

        let eta_seconds = start_time.and_then(|start| {
            let elapsed = start.elapsed().as_secs_f64();
            let ratio = frames_received as f64 / total_frames as f64;
            if ratio > 0.0 && frames_received >= report_interval as u64 {
                Some((elapsed / ratio - elapsed).max(0.0))
            } else {
                None
            }
        });

        let total_digits = total_frames.to_string().len();
        if let Some(eta) = eta_seconds {
            print!(
                "\r[TAURI] Rendering: {:6.2}% ({:width$}/{}) ETA: {:02}:{:02} ... ",
                progress_percent,
                frames_received,
                total_frames,
                (eta / 60.0) as u32,
                (eta % 60.0) as u32,
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

    // Write frame data to FFmpeg stdin.
    if let Err(e) = ffmpeg::write_frame_data(data) {
        eprintln!("\n[WS Server] {}", e);
    }
}

// ── IPC invoke dispatch ─────────────────────────────────────────────

async fn handle_invoke(json: &Value) -> String {
    let id = json["id"].as_u64().unwrap_or(0); // Default to 0 for malformed requests
    let command = json["command"].as_str().unwrap_or("");
    let args = json
        .get("args")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    let result = dispatch_command(command, &args);

    match result {
        Ok(value) => serde_json::json!({
            "type": "invoke-response",
            "id": id,
            "result": value,
        })
        .to_string(),
        Err(e) => serde_json::json!({
            "type": "invoke-error",
            "id": id,
            "error": e,
        })
        .to_string(),
    }
}

fn dispatch_command(command: &str, args: &Value) -> Result<Value, String> {
    match command {
        // ── Existing Tauri commands ────────────────────────────
        "get_files_opened" => {
            let files: Vec<String> = crate::FILES_OPENED
                .lock()
                .unwrap()
                .clone()
                .into_iter()
                .map(|f| f.to_string_lossy().into_owned())
                .collect();
            Ok(serde_json::to_value(files).unwrap())
        }
        "get_args" => {
            let a = crate::CLI_ARGS.lock().unwrap().clone();
            Ok(serde_json::to_value(a).unwrap())
        }
        "get_current_dir" => {
            let dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|pp| pp.to_string_lossy().into_owned()))
                .unwrap_or_default();
            Ok(Value::String(dir))
        }
        "set_ffmpeg_path" => {
            let path = args["path"]
                .as_str()
                .ok_or("Missing 'path' argument")?;
            ffmpeg::set_ffmpeg_path(path)?;
            Ok(Value::Null)
        }
        "get_ffmpeg_encoders" => {
            let encoders = ffmpeg::get_encoders()?;
            Ok(serde_json::to_value(encoders).unwrap())
        }
        "convert_audio" => {
            let input = args["input"]
                .as_str()
                .ok_or("Missing 'input'")?
                .to_string();
            let output = args["output"]
                .as_str()
                .ok_or("Missing 'output'")?
                .to_string();
            let app = APP_HANDLE
                .lock()
                .unwrap()
                .clone()
                .ok_or("App handle not available")?;
            ffmpeg::convert_audio(app, input, output)?;
            Ok(Value::Null)
        }
        "setup_video" => {
            let output = args["output"]
                .as_str()
                .ok_or("Missing 'output'")?
                .to_string();
            let resolution = args["resolution"]
                .as_str()
                .ok_or("Missing 'resolution'")?
                .to_string();
            let frame_rate = args["frameRate"]
                .as_u64()
                .ok_or("Missing 'frameRate'")? as u32;
            let duration = args["duration"]
                .as_f64()
                .ok_or("Missing 'duration'")?;
            let codec = args["codec"]
                .as_str()
                .ok_or("Missing 'codec'")?
                .to_string();
            let bitrate = args["bitrate"]
                .as_str()
                .ok_or("Missing 'bitrate'")?
                .to_string();

            let (total_frames, report_interval) = ffmpeg::setup_video_process(
                output, resolution, frame_rate, duration, codec, bitrate,
            )?;

            let mut state = FRAME_STATE.lock().unwrap();
            state.active = true;
            state.frames_received = 0;
            state.total_frames = total_frames;
            state.report_interval = report_interval;
            state.start_time = None;

            Ok(Value::Null)
        }
        "finish_video" => {
            FRAME_STATE.lock().unwrap().active = false;
            ffmpeg::finish_video()?;
            Ok(Value::Null)
        }
        "combine_streams" => {
            let input_video = args["inputVideo"]
                .as_str()
                .ok_or("Missing 'inputVideo'")?
                .to_string();
            let input_music = args["inputMusic"]
                .as_str()
                .ok_or("Missing 'inputMusic'")?
                .to_string();
            let input_hitsounds = args["inputHitsounds"]
                .as_str()
                .ok_or("Missing 'inputHitsounds'")?
                .to_string();
            let music_volume = args["musicVolume"]
                .as_f64()
                .ok_or("Missing 'musicVolume'")? as f32;
            let audio_bitrate = args["audioBitrate"]
                .as_str()
                .ok_or("Missing 'audioBitrate'")?
                .to_string();
            let output = args["output"]
                .as_str()
                .ok_or("Missing 'output'")?
                .to_string();
            let app = APP_HANDLE
                .lock()
                .unwrap()
                .clone()
                .ok_or("App handle not available")?;
            ffmpeg::combine_streams(
                app,
                input_video,
                input_music,
                input_hitsounds,
                music_volume,
                audio_bitrate,
                output,
            )?;
            Ok(Value::Null)
        }
        "mix_audio" => {
            let sounds: Vec<audio::Sound> = serde_json::from_value(args["sounds"].clone())
                .map_err(|e| format!("Invalid 'sounds': {}", e))?;
            let timestamps: Vec<audio::Timestamp> =
                serde_json::from_value(args["timestamps"].clone())
                    .map_err(|e| format!("Invalid 'timestamps': {}", e))?;
            let length = args["length"].as_f64().ok_or("Missing 'length'")?;
            let output = args["output"]
                .as_str()
                .ok_or("Missing 'output'")?
                .to_string();
            let app = APP_HANDLE
                .lock()
                .unwrap()
                .clone()
                .ok_or("App handle not available")?;
            audio::mix_audio(app, sounds, timestamps, length, output)?;
            Ok(Value::Null)
        }
        "console_log" => {
            let message = args["message"]
                .as_str()
                .ok_or("Missing 'message'")?;
            let severity = args["severity"]
                .as_str()
                .ok_or("Missing 'severity'")?;
            crate::do_console_log(message, severity);
            Ok(Value::Null)
        }
        "close" => {
            if let Some(app) = APP_HANDLE.lock().unwrap().as_ref() {
                for window in app.webview_windows().values() {
                    let _ = window.close();
                }
            }
            Ok(Value::Null)
        }

        // ── FS bridge commands (browser-only) ──────────────────
        "get_temp_dir" => {
            let dir = std::env::temp_dir().to_string_lossy().into_owned();
            Ok(Value::String(dir))
        }
        "get_video_dir" => {
            let dir = dirs::video_dir()
                .or_else(dirs::home_dir)
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            Ok(Value::String(dir))
        }
        "fs_mkdir" => {
            let path = args["path"].as_str().ok_or("Missing 'path'")?;
            let recursive = args["recursive"].as_bool().unwrap_or(false);
            if recursive {
                std::fs::create_dir_all(path)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            } else {
                std::fs::create_dir(path)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }
            Ok(Value::Null)
        }
        "fs_remove" => {
            let path = args["path"].as_str().ok_or("Missing 'path'")?;
            let recursive = args["recursive"].as_bool().unwrap_or(false);
            let p = std::path::Path::new(path);
            if p.is_dir() {
                if recursive {
                    std::fs::remove_dir_all(path)
                        .map_err(|e| format!("Failed to remove: {}", e))?;
                } else {
                    std::fs::remove_dir(path)
                        .map_err(|e| format!("Failed to remove: {}", e))?;
                }
            } else {
                std::fs::remove_file(path)
                    .map_err(|e| format!("Failed to remove: {}", e))?;
            }
            Ok(Value::Null)
        }
        "fs_write_file" => {
            let path = args["path"].as_str().ok_or("Missing 'path'")?;
            let data_b64 = args["dataBase64"]
                .as_str()
                .ok_or("Missing 'dataBase64'")?;
            let data = STANDARD
                .decode(data_b64)
                .map_err(|e| format!("Invalid base64: {}", e))?;
            std::fs::write(path, &data)
                .map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(Value::Null)
        }
        "fs_read_file" => {
            let path = args["path"].as_str().ok_or("Missing 'path'")?;
            let data = std::fs::read(path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            let encoded = STANDARD.encode(&data);
            Ok(Value::String(encoded))
        }
        "open_path" => {
            let path = args["path"].as_str().ok_or("Missing 'path'")?;
            open::that(path).map_err(|e| format!("Failed to open path: {}", e))?;
            Ok(Value::Null)
        }
        "get_path_sep" => {
            Ok(Value::String(std::path::MAIN_SEPARATOR.to_string()))
        }

        _ => Err(format!("Unknown command: {}", command)),
    }
}
