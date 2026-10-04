use crate::book_service::models::Book;
use crate::utils::errors::{AppError, AppResult};
use mp4ameta::{Chapter, Tag};
use std::ffi::{c_char, c_void, CStr};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(crate) struct WindowsExportTrack {
    pub path: PathBuf,
    pub title: String,
    pub duration_seconds: Option<f64>,
}

struct CallbackContext<'a> {
    on_progress: &'a mut dyn FnMut(usize, u8),
}

unsafe extern "C" fn is_cancelled(_context: *mut c_void) -> i32 {
    crate::book_service::ios_export::ios_export_cancel_requested() as i32
}

unsafe extern "C" fn report_progress(
    context: *mut c_void,
    track_index: usize,
    percent: u32,
) {
    if let Some(context) = (context as *mut CallbackContext<'_>).as_mut() {
        (context.on_progress)(track_index, percent.min(100) as u8);
    }
}

unsafe extern "C" {
    fn aurora_mf_export_aac(
        input_paths: *const *const u16,
        duration_hints: *const f64,
        input_count: usize,
        output_path: *const u16,
        chapter_starts_100ns: *mut i64,
        is_cancelled: unsafe extern "C" fn(*mut c_void) -> i32,
        report_progress: unsafe extern "C" fn(*mut c_void, usize, u32),
        callback_context: *mut c_void,
        error: *mut c_char,
        error_capacity: usize,
    ) -> i32;
}

pub(crate) fn export_m4a_or_m4b(
    output_path: &Path,
    book: &Book,
    format: &str,
    tracks: &[WindowsExportTrack],
    mut on_progress: impl FnMut(usize, u8),
) -> AppResult<()> {
    if tracks.is_empty() {
        return Err(AppError::Store(
            "No exportable audio tracks found for MP4 export".to_string(),
        ));
    }

    let parent = output_path.parent().filter(|path| !path.as_os_str().is_empty());
    if let Some(parent) = parent {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::Store(format!(
                "Failed to create export directory {}: {}",
                parent.display(),
                error
            ))
        })?;
    }
    let temp_file = tempfile::Builder::new()
        .suffix(".mp4")
        .tempfile_in(parent.unwrap_or_else(|| Path::new(".")))
        .map_err(|error| AppError::Store(format!("Failed to create MP4 temp file: {error}")))?;
    let temp_path = temp_file.into_temp_path();
    std::fs::remove_file(&temp_path).map_err(|error| {
        AppError::Store(format!("Failed to prepare MP4 temp file: {error}"))
    })?;

    let wide_paths: Vec<Vec<u16>> = tracks
        .iter()
        .map(|track| {
            track
                .path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        })
        .collect();
    let path_ptrs: Vec<*const u16> = wide_paths.iter().map(|path| path.as_ptr()).collect();
    let output_wide: Vec<u16> = temp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let duration_hints: Vec<f64> = tracks
        .iter()
        .map(|track| track.duration_seconds.unwrap_or(0.0))
        .collect();
    let mut chapter_starts_100ns = vec![0i64; tracks.len()];
    let mut callback_context = CallbackContext {
        on_progress: &mut on_progress,
    };
    let mut error = vec![0 as c_char; 1024];

    let status = unsafe {
        aurora_mf_export_aac(
            path_ptrs.as_ptr(),
            duration_hints.as_ptr(),
            path_ptrs.len(),
            output_wide.as_ptr(),
            chapter_starts_100ns.as_mut_ptr(),
            is_cancelled,
            report_progress,
            &mut callback_context as *mut CallbackContext<'_> as *mut c_void,
            error.as_mut_ptr(),
            error.len(),
        )
    };
    if status != 0 {
        let message = unsafe { CStr::from_ptr(error.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        if status as u32 == 0x8007_04C7 {
            return Err(AppError::Encoding("Audio export cancelled".into()));
        }
        return Err(AppError::Encoding(if message.is_empty() {
            format!("Windows Media Foundation AAC export failed (0x{:08X})", status as u32)
        } else {
            message
        }));
    }

    let mut tag = Tag::default();
    tag.set_title(book.title.clone());
    tag.set_album(book.title.clone());
    tag.set_artist(book.author.clone());
    tag.set_album_artist(book.author.clone());
    if let Some(year) = book.published_year.as_deref().filter(|year| !year.is_empty()) {
        tag.set_year(year.to_string());
    }
    let genre = book.subjects.as_ref().map(|subjects| {
        subjects
            .iter()
            .filter(|subject| !subject.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
    });
    if let Some(genre) = genre.as_deref().filter(|genre| !genre.is_empty()) {
        tag.set_genre(genre.to_string());
    }
    if format == "m4b" {
        for (track, start_100ns) in tracks.iter().zip(chapter_starts_100ns) {
            let nanos = start_100ns.max(0) as u64 * 100;
            tag.chapter_list_mut()
                .push(Chapter::new(Duration::from_nanos(nanos), track.title.clone()));
        }
    }
    tag.write_to_path(&temp_path)
        .map_err(|error| AppError::Encoding(format!("Failed to write MP4 tags: {error}")))?;

    std::fs::copy(&temp_path, output_path).map_err(|error| {
        AppError::Store(format!(
            "Failed to write {} export to {}: {}",
            format.to_uppercase(),
            output_path.display(),
            error
        ))
    })?;
    Ok(())
}