//! Export captured logs to a zip archive and email them with a full attachment.
//!
//! * **macOS / Windows** — export uses a native save dialog on the frontend, then
//!   writes the chosen path. Email writes a `.eml` draft (to/subject/body + zip
//!   attachment) and opens it with the system default handler (Mail / Outlook).
//! * **iOS** — export writes under Documents/Exports and presents the share sheet.
//!   Email opens the default mail app via `mailto:` (no attachment).

use crate::utils::errors::{AppError, AppResult};
use crate::utils::path_resolver::ResourcePathResolver;
#[cfg(not(target_os = "ios"))]
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;
use zip::{write::FileOptions, CompressionMethod, ZipWriter};

fn default_log_filename() -> String {
    format!("aurorabook-logs-{}.zip", chrono_like_stamp())
}

fn chrono_like_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn inner_log_txt_name(zip_path: &Path) -> String {
    let stem = zip_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("aurorabook-logs");
    format!("{stem}.txt")
}

fn build_log_zip(inner_txt_name: &str, contents: &str) -> AppResult<Vec<u8>> {
    let mut zip_writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
    zip_writer
        .start_file(inner_txt_name, options)
        .map_err(|e| AppError::ZipArchive(format!("Failed to start log zip entry: {e}")))?;
    zip_writer
        .write_all(contents.as_bytes())
        .map_err(|e| AppError::ZipArchive(format!("Failed to write log zip entry: {e}")))?;
    let cursor = zip_writer
        .finish()
        .map_err(|e| AppError::ZipArchive(format!("Failed to finalize log zip: {e}")))?;
    Ok(cursor.into_inner())
}

fn ensure_parent_dir(path: &Path) -> AppResult<()> {
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
    Ok(())
}

fn write_log_zip_file(path: &Path, contents: &str) -> AppResult<()> {
    ensure_parent_dir(path)?;
    let zip_bytes = build_log_zip(&inner_log_txt_name(path), contents)?;
    std::fs::write(path, zip_bytes).map_err(|e| {
        AppError::Store(format!(
            "Failed to write log zip {}: {}",
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
            "zip",
        )
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        ResourcePathResolver::prepare_writable_output_path(output_path)
    }
}

/// Save log text as a zip archive. On iOS, also presents the share sheet.
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
    write_log_zip_file(&dest, &contents)?;

    #[cfg(target_os = "ios")]
    {
        crate::book_service::ios_export::share_exported_file(&dest)?;
    }

    Ok(())
}

/// Open a bug-report email. Desktop attaches the zipped log file; iOS opens mailto only.
#[tauri::command]
pub async fn email_logs_report(
    app: tauri::AppHandle,
    contents: String,
    to: String,
    subject: String,
    body: String,
) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    {
        let _ = contents;
        open_mailto_ios(&app, &to, &subject, &body)?;
    }

    #[cfg(not(target_os = "ios"))]
    {
        let file_name = default_log_filename();
        let log_contents = if contents.is_empty() {
            "(no logs captured)\n".to_string()
        } else {
            contents
        };
        let temp_dir = app
            .path()
            .temp_dir()
            .map_err(|e| AppError::Store(format!("temp_dir unavailable: {e}")))?;
        let zip_path = temp_dir.join(&file_name);
        let zip_bytes = build_log_zip(&inner_log_txt_name(&zip_path), &log_contents)?;
        ensure_parent_dir(&zip_path)?;
        std::fs::write(&zip_path, &zip_bytes).map_err(|e| {
            AppError::Store(format!(
                "Failed to write log zip {}: {}",
                zip_path.display(),
                e
            ))
        })?;
        let eml_path = temp_dir.join("aurorabook-bug-report.eml");
        write_eml_with_attachment(&eml_path, &to, &subject, &body, &file_name, &zip_bytes)?;
        open_email_draft(&eml_path)?;
    }

    Ok(())
}

/// Open the system default mail app with a prefilled draft (no attachment).
#[cfg(target_os = "ios")]
fn open_mailto_ios(
    app: &tauri::AppHandle,
    to: &str,
    subject: &str,
    body: &str,
) -> AppResult<()> {
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    use tauri_plugin_opener::OpenerExt;

    let safe_to = to.trim().replace(['\r', '\n'], "");
    if safe_to.is_empty() {
        return Err(AppError::Store("Support email address is empty".into()));
    }

    let subject_enc = utf8_percent_encode(subject, NON_ALPHANUMERIC).to_string();
    let body_enc = utf8_percent_encode(body, NON_ALPHANUMERIC).to_string();
    let mailto = format!("mailto:{safe_to}?subject={subject_enc}&body={body_enc}");

    app.opener()
        .open_url(&mailto, None::<&str>)
        .map_err(|e| AppError::Store(format!("Failed to open default mail app: {e}")))
}

#[cfg(not(target_os = "ios"))]
fn write_eml_with_attachment(
    eml_path: &Path,
    to: &str,
    subject: &str,
    body: &str,
    attachment_name: &str,
    attachment_bytes: &[u8],
) -> AppResult<()> {
    let boundary = format!("AuroraBookBoundary{}", chrono_like_stamp());
    let encoded = BASE64.encode(attachment_bytes);
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
Content-Type: application/zip; name=\"{attachment_name}\"\r\n\
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
