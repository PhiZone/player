use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::Manager;
use url::Url;

static INCOMING_FILES: LazyLock<Mutex<Vec<PathBuf>>> = LazyLock::new(|| Mutex::new(vec![]));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                // register deep links
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;

                // handle associated files
                // seek for files in the command line arguments
                for maybe_file in std::env::args().skip(1) {
                    println!("may-be file: {:?}", maybe_file);
                    // skip flags like -f or --flag
                    if maybe_file.starts_with('-') {
                        continue;
                    }

                    let mut success = false;
                    // handle `file://` path urls and skip other urls
                    if let Ok(url) = Url::parse(&maybe_file) {
                        if !url.cannot_be_a_base() {
                            if let Ok(path) = url.to_file_path() {
                                INCOMING_FILES.lock().unwrap().push(path);
                                success = true;
                            }
                        }
                    }
                    if !success {
                        INCOMING_FILES.lock().unwrap().push(PathBuf::from(maybe_file))
                    }
                }
                println!("incoming files ({:?}): {:?}", INCOMING_FILES.lock().unwrap().len(), INCOMING_FILES);
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
        .invoke_handler(tauri::generate_handler![get_incoming_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_incoming_files() -> Vec<String> {
    INCOMING_FILES.lock().unwrap().clone().into_iter().map(|f| f.to_string_lossy().into_owned()).collect()
}