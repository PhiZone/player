use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use url::Url;

mod audio;
mod ffmpeg;

static CLI_ARGS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static FILES_OPENED: LazyLock<Mutex<Vec<PathBuf>>> = LazyLock::new(|| Mutex::new(vec![]));

static WEBHOOK_CONFIG: LazyLock<Option<(String, String)>> = LazyLock::new(|| {
    let run_id = std::env::var("RUN_ID").ok().filter(|s| !s.is_empty())?;
    let webhook_url = std::env::var("WEBHOOK_URL")
        .ok()
        .filter(|s| !s.is_empty())?;
    Some((run_id, webhook_url))
});

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Parse arguments to extract files
            let mut temp_args_map = HashMap::new();
            parse_args(&mut temp_args_map, args.iter().map(|s| s.to_string()));
            let files = extract_files_from_args(&temp_args_map);

            let window = app.get_webview_window("main").expect("no main window");
            window
                .emit(
                    "files-opened",
                    files
                        .into_iter()
                        .map(|f| f.to_string_lossy().into_owned())
                        .collect::<Vec<String>>(),
                )
                .unwrap();
            let _ = window.set_focus();
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                // register deep links
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            // parse CLI arguments first
            parse_args(&mut CLI_ARGS.lock().unwrap(), std::env::args());

            // extract files from parsed arguments
            let files = extract_files_from_args(&CLI_ARGS.lock().unwrap());
            *FILES_OPENED.lock().unwrap() = files;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_files_opened,
            get_args,
            get_current_dir,
            set_ffmpeg_path,
            get_ffmpeg_encoders,
            convert_audio,
            setup_video,
            finish_video,
            combine_streams,
            mix_audio,
            console_log,
            close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn send_webhook_notification(status: &str, progress: f64) {
    let (run_id, webhook_url) = match WEBHOOK_CONFIG.as_ref() {
        Some((run_id, webhook_url)) => (run_id.clone(), webhook_url.clone()),
        None => return, // No webhook configuration available
    };

    let payload = serde_json::json!({
        "run_id": run_id,
        "status": status,
        "progress": progress
    });

    std::thread::spawn(move || {
        let client = ureq::agent();
        let result = client
            .post(&webhook_url)
            .header("Content-Type", "application/json")
            .send_json(&payload);

        if let Err(e) = result {
            eprintln!("[TAURI] Failed to send webhook notification: {}", e);
        }
    });
}

pub fn cmd_hidden(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = cmd;
        cmd.creation_flags(0x08000000);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    cmd
}

fn extract_files_from_args(args_map: &HashMap<String, String>) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();

    // Extract positional arguments (stored as arg0, arg1, etc.) which are file paths
    let mut arg_indices: Vec<usize> = Vec::new();
    for key in args_map.keys() {
        if key.starts_with("arg") {
            if let Ok(index) = key[3..].parse::<usize>() {
                arg_indices.push(index);
            }
        }
    }

    // Sort indices to process arguments in order
    arg_indices.sort();

    for index in arg_indices {
        let key = format!("arg{}", index);
        if let Some(maybe_file) = args_map.get(&key) {
            let mut success = false;
            // handle `file://` path urls and skip other urls
            if let Ok(url) = Url::parse(maybe_file) {
                if !url.cannot_be_a_base() {
                    if let Ok(path) = url.to_file_path() {
                        files.push(path);
                        success = true;
                    }
                }
            }
            if !success {
                files.push(PathBuf::from(maybe_file))
            }
        }
    }

    println!("[TAURI] Files opened ({:?}): {:?}", files.len(), files);
    files
}

fn parse_args<T: Iterator<Item = String>>(args_map: &mut HashMap<String, String>, args: T) {
    let args_vec: Vec<String> = args.collect();
    let mut i = 1; // skip the program name

    while i < args_vec.len() {
        let arg = &args_vec[i];

        // Handle long flags (--key=value or --key value)
        if arg.starts_with("--") {
            let key = arg.trim_start_matches("--");

            // Check if it's in the format --key=value
            if let Some(eq_pos) = key.find('=') {
                let (k, v) = key.split_at(eq_pos);
                let value = &v[1..]; // skip the '=' character
                args_map.insert(k.to_string(), value.to_string());
                i += 1;
            } else {
                // Check if the next argument is the value
                if i + 1 < args_vec.len() && !args_vec[i + 1].starts_with('-') {
                    args_map.insert(key.to_string(), args_vec[i + 1].clone());
                    i += 2;
                } else {
                    // It's a boolean flag
                    args_map.insert(key.to_string(), "true".to_string());
                    i += 1;
                }
            }
        }
        // Handle short flags (-k value or -k=value)
        else if arg.starts_with('-') && arg.len() > 1 {
            let key = arg.trim_start_matches('-');

            // Check if it's in the format -k=value
            if let Some(eq_pos) = key.find('=') {
                let (k, v) = key.split_at(eq_pos);
                let value = &v[1..]; // skip the '=' character
                args_map.insert(k.to_string(), value.to_string());
                i += 1;
            } else {
                // Check if the next argument is the value
                if i + 1 < args_vec.len() && !args_vec[i + 1].starts_with('-') {
                    args_map.insert(key.to_string(), args_vec[i + 1].clone());
                    i += 2;
                } else {
                    // It's a boolean flag
                    args_map.insert(key.to_string(), "true".to_string());
                    i += 1;
                }
            }
        }
        // Handle positional arguments
        else {
            args_map.insert(format!("arg{}", i - 1), arg.clone());
            i += 1;
        }
    }

    println!("[TAURI] Args parsed ({:?}): {:?}", args_map.len(), args_map);
}

#[tauri::command]
fn get_files_opened() -> Vec<String> {
    FILES_OPENED
        .lock()
        .unwrap()
        .clone()
        .into_iter()
        .map(|f| f.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn get_args() -> HashMap<String, String> {
    CLI_ARGS.lock().unwrap().clone()
}

#[tauri::command]
fn get_current_dir() -> String {
    std::env::current_exe()
        .map(|p| p.parent().unwrap().to_string_lossy().into_owned())
        .unwrap_or_else(|_| String::new())
}

#[tauri::command]
fn set_ffmpeg_path(path: &str) -> Result<(), String> {
    ffmpeg::set_ffmpeg_path(path)
}

#[tauri::command]
fn get_ffmpeg_encoders() -> Result<Vec<ffmpeg::Encoder>, String> {
    ffmpeg::get_encoders()
}

#[tauri::command]
fn convert_audio(app: AppHandle, input: String, output: String) -> Result<(), String> {
    ffmpeg::convert_audio(app, input, output)
}

#[tauri::command]
async fn setup_video(
    output: String,
    resolution: String,
    frame_rate: u32,
    duration: f64,
    codec: String,
    bitrate: String,
) -> Result<(), String> {
    ffmpeg::setup_video(output, resolution, frame_rate, duration, codec, bitrate).await
}

#[tauri::command]
fn finish_video() -> Result<(), String> {
    ffmpeg::finish_video()
}

#[tauri::command]
fn combine_streams(
    app: AppHandle,
    input_video: String,
    input_music: String,
    input_hitsounds: String,
    music_volume: f32,
    audio_bitrate: String,
    output: String,
) -> Result<(), String> {
    ffmpeg::combine_streams(
        app,
        input_video,
        input_music,
        input_hitsounds,
        music_volume,
        audio_bitrate,
        output,
    )
}

#[tauri::command]
fn mix_audio(
    app: AppHandle,
    sounds: Vec<audio::Sound>,
    timestamps: Vec<audio::Timestamp>,
    length: f64,
    output: String,
) -> Result<(), String> {
    audio::mix_audio(app, sounds, timestamps, length, output)
}

#[tauri::command]
fn console_log(message: String, severity: String) -> Result<(), String> {
    match severity.to_lowercase().as_str() {
        "error" => {
            eprintln!("[ERROR] {}", message);
            log::error!("{}", message);
        }
        "warn" | "warning" => {
            println!("[WARN] {}", message);
            log::warn!("{}", message);
        }
        "info" => {
            println!("[INFO] {}", message);
            log::info!("{}", message);
        }
        "debug" => {
            println!("[DEBUG] {}", message);
            log::debug!("{}", message);
        }
        "trace" => {
            println!("[TRACE] {}", message);
            log::trace!("{}", message);
        }
        _ => {
            // Default to log level for unknown severity
            println!("[LOG] {}", message);
            log::info!("{}", message);
        }
    }
    Ok(())
}

#[tauri::command]
fn close(app: AppHandle) -> Result<(), String> {
    for window in app.webview_windows().values() {
        let _ = window.close();
    }
    Ok(())
}
