use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use url::Url;

mod ffmpeg;
mod rodio;

static FILES_OPENED: LazyLock<Mutex<Vec<PathBuf>>> = LazyLock::new(|| Mutex::new(vec![]));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let mut files: Vec<PathBuf> = Vec::new();
            parse_files_opened(&mut files, args.iter().map(|s| s.to_string()));
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

                // handle associated files
                parse_files_opened(&mut FILES_OPENED.lock().unwrap(), std::env::args());
            }
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
            get_ffmpeg_encoders,
            convert_audio,
            compose_audio,
            setup_video,
            finish_video,
            combine_streams,
            mix_audio
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn parse_files_opened<T: Iterator<Item = String>>(files: &mut Vec<PathBuf>, args: T) {
    // seek for files in the command line arguments
    for maybe_file in args.skip(1) {
        // skip flags like -f or --flag
        if maybe_file.starts_with('-') {
            continue;
        }

        let mut success = false;
        // handle `file://` path urls and skip other urls
        if let Ok(url) = Url::parse(&maybe_file) {
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
    println!("files opened ({:?}): {:?}", files.len(), files);
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
fn get_ffmpeg_encoders() -> Result<Vec<ffmpeg::Encoder>, String> {
    ffmpeg::get_encoders()
}

#[tauri::command]
fn convert_audio(app: AppHandle, input: String, output: String) -> Result<(), String> {
    ffmpeg::convert_audio(app, input, output)
}

#[tauri::command]
fn compose_audio(
    app: AppHandle,
    hitsounds: String,
    music: String,
    volume: f32,
    bitrate: String,
    output: String,
) -> Result<(), String> {
    ffmpeg::compose_audio(app, hitsounds, music, volume, bitrate, output)
}

#[tauri::command]
async fn setup_video(
    output: String,
    resolution: String,
    frame_rate: u32,
    codec: String,
    bitrate: String,
) -> Result<(), String> {
    ffmpeg::setup_video(output, resolution, frame_rate, codec, bitrate).await
}

#[tauri::command]
fn finish_video() -> Result<(), String> {
    ffmpeg::finish_video()
}

#[tauri::command]
fn combine_streams(
    app: AppHandle,
    input_video: String,
    input_audio: String,
    output: String,
) -> Result<(), String> {
    ffmpeg::combine_streams(app, input_video, input_audio, output)
}

#[tauri::command]
fn mix_audio(
    app: AppHandle,
    music_file: String,
    music_volume: f32,
    sounds: Vec<rodio::Sound>,
    timestamps: Vec<rodio::Timestamp>,
    length: f64,
    bitrate: String,
    video_file: String,
    render_output: String,
) -> Result<(), String> {
    rodio::mix_audio(app, music_file, music_volume, sounds, timestamps, length, bitrate, video_file, render_output)
}
