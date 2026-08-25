use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::book_service::database::try_get_db_pool;
use crate::book_service::models::AppLogEntry;
use crate::book_service::repositories::AppLogsRepository;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

static APP_HANDLE: std::sync::OnceLock<std::sync::Arc<std::sync::Mutex<Option<AppHandle>>>> =
    std::sync::OnceLock::new();

thread_local! {
    /// Prevents recursion when reporting `emit("backend-log")` failures via `log::warn!`.
    static SUPPRESS_UI_LOG_FORWARD: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Initialize the log forwarding system
pub fn init_log_forwarding(app: &AppHandle) {
    let handle = app.clone();
    APP_HANDLE
        .set(std::sync::Arc::new(std::sync::Mutex::new(Some(handle))))
        .ok();
}

fn iso_timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();
    let (year, month, day, hour, min, sec) = civil_utc_from_unix(secs);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

/// Convert Unix seconds to UTC civil date/time without an external chrono crate.
fn civil_utc_from_unix(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let day_secs = 86_400u64;
    let days = (secs / day_secs) as i64;
    let rem = (secs % day_secs) as u32;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;

    // Days from civil algorithm (Howard Hinnant).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32, hour, min, sec)
}

/// Forward a log entry to the frontend and persist it in SQLite.
fn forward_log(entry: LogEntry) {
    persist_backend_log(&entry);

    if let Some(handle_arc) = APP_HANDLE.get() {
        if let Ok(handle_guard) = handle_arc.lock() {
            if let Some(app) = handle_guard.as_ref() {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.emit("backend-log", &entry) {
                        SUPPRESS_UI_LOG_FORWARD.with(|c| c.set(true));
                        log::warn!(target: "tauri::log_forward", "Failed to emit backend log: {}", e);
                        SUPPRESS_UI_LOG_FORWARD.with(|c| c.set(false));
                    }
                }
            }
        }
    }
}

fn persist_backend_log(entry: &LogEntry) {
    let Some(pool) = try_get_db_pool() else {
        return;
    };
    let model = AppLogEntry {
        timestamp: entry.timestamp.clone(),
        level: entry.level.clone(),
        source: entry.source.clone(),
        message: entry.message.clone(),
        data: entry.data.clone(),
    };
    tauri::async_runtime::spawn(async move {
        if let Err(e) = AppLogsRepository::append(pool.as_ref(), &model).await {
            // Avoid re-entering FrontendLogger via log:: macros.
            eprintln!("[app_logs] failed to persist backend log: {e}");
        }
    });
}

/// Create a log entry and forward it to the in-app viewer.
/// Debug builds: all levels. Release: warn + error only (device debugging).
pub fn log(level: &str, message: &str, data: Option<serde_json::Value>) {
    if !cfg!(debug_assertions) && level != "error" && level != "warn" {
        return;
    }

    let entry = LogEntry {
        timestamp: iso_timestamp_now(),
        level: level.to_string(),
        source: "backend".to_string(),
        message: message.to_string(),
        data,
    };

    forward_log(entry);
}

/// Custom logger that forwards to frontend and also writes to stderr
pub struct FrontendLogger {
    inner: env_logger::Logger,
}

impl FrontendLogger {
    pub fn new() -> Self {
        // Debug: trace by default (override with RUST_LOG). Release: warn+ to stderr (override with RUST_LOG).
        let default_filter = if cfg!(debug_assertions) {
            "trace"
        } else {
            "warn"
        };
        let inner =
            env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(default_filter))
                .format(|buf, record| {
                    use std::io::Write;
                    let level = record.level();
                    let target = record.target();
                    let args = record.args();

                    // Write to stderr (standard logging)
                    writeln!(buf, "[{} {}] {}", level, target, args)
                })
                .build();

        Self { inner }
    }
}

impl log::Log for FrontendLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        self.inner.enabled(metadata)
    }

    fn log(&self, record: &log::Record) {
        // First, let the inner logger handle stderr output
        self.inner.log(record);

        // Then forward to frontend (skip when handling emit failure — avoids re-entrancy)
        if self.enabled(record.metadata()) && !SUPPRESS_UI_LOG_FORWARD.with(|c| c.get()) {
            let level = match record.level() {
                log::Level::Error => "error",
                log::Level::Warn => "warn",
                log::Level::Info => "info",
                log::Level::Debug => "debug",
                log::Level::Trace => "debug",
            };

            let target = record.target();
            let message = format!("{}", record.args());

            // Include target (module path) in the message for better context
            let full_message = if target != "aurorabook_lib" && !target.starts_with("aurorabook") {
                format!("[{}] {}", target, message)
            } else {
                message
            };

            // Extract additional data if available
            let data = Some(serde_json::json!({
                "target": target,
                "module_path": record.module_path().unwrap_or("unknown"),
                "file": record.file().unwrap_or("unknown"),
                "line": record.line().unwrap_or(0),
            }));

            log(level, &full_message, data);
        }
    }

    fn flush(&self) {
        self.inner.flush();
    }
}
