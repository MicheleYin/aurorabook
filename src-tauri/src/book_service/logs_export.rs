//! Export captured logs to a file and email them with a full attachment.
//!
//! * **macOS / Windows** — export uses a native save dialog on the frontend, then
//!   writes the chosen path. Email writes a `.eml` draft (to/subject/body + log
//!   attachment) and opens it with the system default handler (Mail / Outlook).
//! * **iOS** — write under Documents/Exports; email uses MessageUI when Apple
//!   Mail is configured, otherwise a `.eml` draft via the share sheet. Export
//!   presents the share sheet for the raw log file.

use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_resolver::ResourcePathResolver;
#[cfg(not(target_os = "ios"))]
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::path::{Path, PathBuf};
use tauri::Manager;

fn default_log_filename() -> String {
    format!("aurorabook-logs-{}.txt", chrono_like_stamp())
}

fn chrono_like_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn write_log_file(path: &Path, contents: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::Store(format!(
                    "Failed to create log export directory {}: {}",
                    parent.display(),
                    e
                ))
            })?;
        }
    }
    std::fs::write(path, contents.as_bytes()).map_err(|e| {
        AppError::Store(format!(
            "Failed to write log file {}: {}",
            path.display(),
            e
        ))
    })?;
    Ok(())
}

fn resolve_export_path(app: &tauri::AppHandle, output_path: &str) -> AppResult<PathBuf> {
    #[cfg(target_os = "ios")]
    {
        crate::book_service::ios_export::resolve_ios_sandbox_export_path(
            app,
            output_path,
            "aurorabook-logs",
            "txt",
        )
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        ResourcePathResolver::prepare_writable_output_path(output_path)
    }
}

/// Save log text to a file. On iOS, also presents the share sheet.
#[tauri::command]
pub async fn export_logs_to_file(
    app: tauri::AppHandle,
    contents: String,
    output_path: String,
) -> AppResult<()> {
    let path = if output_path.trim().is_empty() {
        default_log_filename()
    } else {
        output_path
    };
    let dest = resolve_export_path(&app, &path)?;
    write_log_file(&dest, &contents)?;

    #[cfg(target_os = "ios")]
    {
        crate::book_service::ios_export::share_exported_file(&dest)?;
    }

    Ok(())
}

/// Open a bug-report email with the full log file attached.
#[tauri::command]
pub async fn email_logs_report(
    app: tauri::AppHandle,
    contents: String,
    to: String,
    subject: String,
    body: String,
) -> AppResult<()> {
    let file_name = default_log_filename();
    let log_contents = if contents.is_empty() {
        "(no logs captured)\n".to_string()
    } else {
        contents
    };

    #[cfg(target_os = "ios")]
    {
        let dest = crate::book_service::ios_export::resolve_ios_sandbox_export_path(
            &app,
            &file_name,
            "aurorabook-logs",
            "txt",
        )?;
        write_log_file(&dest, &log_contents)?;
        compose_mail_ios(&to, &subject, &body, &dest)?;
    }

    #[cfg(not(target_os = "ios"))]
    {
        let temp_dir = app
            .path()
            .temp_dir()
            .map_err(|e| AppError::Store(format!("temp_dir unavailable: {e}")))?;
        let log_path = temp_dir.join(&file_name);
        write_log_file(&log_path, &log_contents)?;
        let eml_path = temp_dir.join("aurorabook-bug-report.eml");
        write_eml_with_attachment(&eml_path, &to, &subject, &body, &file_name, &log_contents)?;
        open_email_draft(&eml_path)?;
    }

    Ok(())
}

#[cfg(target_os = "ios")]
extern "C" {
    fn aurora_compose_mail_with_attachment(
        to: *const std::ffi::c_char,
        subject: *const std::ffi::c_char,
        body: *const std::ffi::c_char,
        attachment_path: *const std::ffi::c_char,
    ) -> i32;
    fn aurora_compose_mail_last_error() -> *mut std::ffi::c_char;
    fn aurora_compose_mail_free_string(ptr: *mut std::ffi::c_char);
}

#[cfg(target_os = "ios")]
fn take_mail_last_error() -> Option<String> {
    // SAFETY: Swift returns a strdup'd C string or null; we free with the paired helper.
    // Codacy: audited Swift @_cdecl FFI — same bridge pattern as ios_export / native_player.
    unsafe {
        let ptr = aurora_compose_mail_last_error();
        if ptr.is_null() {
            return None;
        }
        let msg = std::ffi::CStr::from_ptr(ptr)
            .to_string_lossy()
            .into_owned();
        aurora_compose_mail_free_string(ptr);
        if msg.is_empty() {
            None
        } else {
            Some(msg)
        }
    }
}

#[cfg(target_os = "ios")]
fn compose_mail_ios(to: &str, subject: &str, body: &str, attachment: &Path) -> AppResult<()> {
    let c_to = std::ffi::CString::new(to)
        .map_err(|_| AppError::Encoding("Mail 'to' contains NUL".into()))?;
    let c_subject = std::ffi::CString::new(subject)
        .map_err(|_| AppError::Encoding("Mail subject contains NUL".into()))?;
    let c_body = std::ffi::CString::new(body)
        .map_err(|_| AppError::Encoding("Mail body contains NUL".into()))?;
    let c_path = std::ffi::CString::new(attachment.to_string_lossy().as_ref())
        .map_err(|_| AppError::Encoding("Attachment path contains NUL".into()))?;

    // SAFETY: CStrings live for the duration of the call; Swift only reads them.
    // Codacy: audited Swift @_cdecl FFI — same bridge pattern as ios_export / native_player.
    let code = unsafe {
        aurora_compose_mail_with_attachment(
            c_to.as_ptr(),
            c_subject.as_ptr(),
            c_body.as_ptr(),
            c_path.as_ptr(),
        )
    };
    if code == 0 {
        return Ok(());
    }
    let detail =
        take_mail_last_error().unwrap_or_else(|| format!("mail compose failed (code {code})"));
    Err(AppError::Store(format!(
        "Failed to compose bug-report email: {detail}"
    )))
}

#[cfg(not(target_os = "ios"))]
fn write_eml_with_attachment(
    eml_path: &Path,
    to: &str,
    subject: &str,
    body: &str,
    attachment_name: &str,
    attachment_contents: &str,
) -> AppResult<()> {
    let boundary = format!("AuroraBookBoundary{}", chrono_like_stamp());
    let encoded = BASE64.encode(attachment_contents.as_bytes());
    let mut folded = String::with_capacity(encoded.len() + encoded.len() / 76);
    for (i, chunk) in encoded.as_bytes().chunks(76).enumerate() {
        if i > 0 {
            folded.push_str("\r\n");
        }
        folded.push_str(std::str::from_utf8(chunk).unwrap_or(""));
    }

    let safe_subject = subject.replace(['\r', '\n'], " ");
    let safe_to = to.replace(['\r', '\n'], " ");
    let eml = format!(
        "MIME-Version: 1.0\r\n\
To: {safe_to}\r\n\
Subject: {safe_subject}\r\n\
Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\
\r\n\
--{boundary}\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
Content-Transfer-Encoding: 8bit\r\n\
\r\n\
{body}\r\n\
\r\n\
--{boundary}\r\n\
Content-Type: text/plain; charset=utf-8; name=\"{attachment_name}\"\r\n\
Content-Disposition: attachment; filename=\"{attachment_name}\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
{folded}\r\n\
--{boundary}--\r\n"
    );

    std::fs::write(eml_path, eml.as_bytes()).map_err(|e| {
        AppError::Store(format!(
            "Failed to write email draft {}: {}",
            eml_path.display(),
            e
        ))
    })?;
    Ok(())
}

/// Open a `.eml` draft with the OS default mail / `.eml` handler (macOS Mail, Outlook, etc.).
#[cfg(not(target_os = "ios"))]
fn open_email_draft(path: &Path) -> AppResult<()> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| {
        AppError::Store(format!(
            "Failed to open email draft {}: {e}",
            path.display()
        ))
    })
}
