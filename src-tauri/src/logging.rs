use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

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

/// Forward a log entry to the frontend
fn forward_log(entry: LogEntry) {
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

/// Create a log entry and forward it to the in-app viewer.
/// Debug builds: all levels. Release: warn + error only (device debugging).
pub fn log(level: &str, message: &str, data: Option<serde_json::Value>) {
    if !cfg!(debug_assertions) && level != "error" && level != "warn" {
        return;
    }
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| {
            let secs = d.as_secs();
            let nanos = d.subsec_nanos();
            format!("{secs}.{nanos:09}Z")
        })
        .unwrap_or_else(|_| "unknown".to_string());

    let entry = LogEntry {
        timestamp,
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
