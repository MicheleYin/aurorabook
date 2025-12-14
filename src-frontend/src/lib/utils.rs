use wasm_bindgen::JsValue;
use web_sys::window;

/// Get a value from window object (for Tauri integration)
pub fn get_window() -> Option<web_sys::Window> {
    window()
}

/// Check if we're running in Tauri
pub fn is_tauri() -> bool {
    if let Some(window) = get_window() {
        let tauri = js_sys::Reflect::get(&window, &JsValue::from_str("__TAURI__"));
        tauri.is_ok() && !tauri.unwrap().is_undefined()
    } else {
        false
    }
}

/// Format time in seconds to MM:SS format
pub fn format_time(seconds: f64) -> String {
    let total_seconds = seconds as u64;
    let minutes = total_seconds / 60;
    let secs = total_seconds % 60;
    format!("{:02}:{:02}", minutes, secs)
}

/// Format playback rate (e.g., 1.5 -> "1.5x", 2.0 -> "2x")
pub fn format_playback_rate(rate: f64) -> String {
    if rate.fract() == 0.0 {
        format!("{}x", rate as u64)
    } else {
        format!("{:.2}x", rate).trim_end_matches('0').trim_end_matches('.').to_string() + "x"
    }
}
