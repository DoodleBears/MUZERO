// MUZERO Tauri shell. The whole app is the web frontend; Rust's job is to host
// the WebView and provide the http/fs/os plugins the frontend uses (CORS-free
// requests to BYOK cloud APIs).
//
// `run()` is the shared entry point for desktop (main.rs) and mobile, where
// `tauri::mobile_entry_point` generates the platform glue.

use tauri_plugin_fs::FsExt;

/// Grant the app runtime read access to a folder the user picked for local
/// import (recursive). The static fs scope ships empty, so nothing on disk is
/// readable until this is called — and the frontend re-issues it each launch
/// from its own remembered-folder list, never broadening beyond the user's
/// explicit picks. Mirrors what the fs plugin already does for dropped folders.
#[tauri::command]
fn allow_read_path(app: tauri::AppHandle, path: String) {
    let _ = app.fs_scope().allow_directory(&path, true);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![allow_read_path])
        .run(tauri::generate_context!())
        .expect("error while running MUZERO");
}
