// MUZERO Tauri shell. The whole app is the web frontend; Rust's job is to host
// the WebView and provide the http/fs/os plugins the frontend uses (CORS-free
// requests to a local ACE-Step server and BYOK LLM APIs).
//
// `run()` is the shared entry point for desktop (main.rs) and mobile, where
// `tauri::mobile_entry_point` generates the platform glue.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running MUZERO");
}
