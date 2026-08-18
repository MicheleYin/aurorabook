//! System dictionary lookup for the in-reader overlay.
//!
//! On macOS this uses `DCSCopyTextDefinition` (the same source as Look Up).

use serde::Serialize;

use crate::utils::errors::AppResult;

const MAX_DICTIONARY_TERM_CHARS: usize = 64;

#[derive(Debug, Serialize)]
pub struct DictionaryLookupResult {
    pub term: String,
    pub definition: Option<String>,
}

pub fn sanitize_dictionary_term(raw: &str) -> Option<String> {
    let trimmed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        return None;
    }
    let mut term = String::new();
    for (index, character) in trimmed.chars().enumerate() {
        if index >= MAX_DICTIONARY_TERM_CHARS {
            return None;
        }
        term.push(character);
    }
    if term.is_empty() {
        None
    } else {
        Some(term)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::ptr;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    #[repr(C)]
    struct CfRange {
        location: isize,
        length: isize,
    }

    type CfStringRef = *const c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithBytes(
            alloc: *const c_void,
            bytes: *const u8,
            num_bytes: isize,
            encoding: u32,
            is_external_representation: u8,
        ) -> CfStringRef;
        fn CFStringGetLength(the_string: CfStringRef) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFStringGetCString(
            the_string: CfStringRef,
            buffer: *mut u8,
            buffer_size: isize,
            encoding: u32,
        ) -> u8;
        fn CFRelease(cf: *const c_void);
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn DCSCopyTextDefinition(
            dictionary: *const c_void,
            text_string: CfStringRef,
            range: CfRange,
        ) -> CfStringRef;
    }

    fn cfstring_from_str(value: &str) -> Option<CfStringRef> {
        let created = unsafe {
            CFStringCreateWithBytes(
                ptr::null(),
                value.as_ptr(),
                value.len() as isize,
                K_CF_STRING_ENCODING_UTF8,
                0,
            )
        };
        if created.is_null() {
            None
        } else {
            Some(created)
        }
    }

    fn cfstring_to_string(value: CfStringRef) -> Option<String> {
        if value.is_null() {
            return None;
        }
        unsafe {
            let length = CFStringGetLength(value);
            if length <= 0 {
                return None;
            }
            let buffer_size = CFStringGetMaximumSizeForEncoding(length, K_CF_STRING_ENCODING_UTF8);
            if buffer_size <= 0 {
                return None;
            }
            let mut buffer = vec![0u8; buffer_size as usize + 1];
            let ok = CFStringGetCString(
                value,
                buffer.as_mut_ptr(),
                buffer.len() as isize,
                K_CF_STRING_ENCODING_UTF8,
            );
            if ok == 0 {
                return None;
            }
            let end = buffer.iter().position(|&byte| byte == 0).unwrap_or(buffer.len());
            String::from_utf8(buffer[..end].to_vec()).ok()
        }
    }

    pub fn copy_text_definition(term: &str) -> Option<String> {
        let cf_term = cfstring_from_str(term)?;
        unsafe {
            let range = CfRange {
                location: 0,
                length: CFStringGetLength(cf_term),
            };
            let definition = DCSCopyTextDefinition(ptr::null(), cf_term, range);
            CFRelease(cf_term);
            if definition.is_null() {
                return None;
            }
            let text = cfstring_to_string(definition);
            CFRelease(definition);
            text.filter(|value| !value.trim().is_empty())
        }
    }
}

#[tauri::command]
pub fn lookup_dictionary(term: String) -> AppResult<DictionaryLookupResult> {
    let Some(sanitized) = sanitize_dictionary_term(&term) else {
        return Ok(DictionaryLookupResult {
            term: String::new(),
            definition: None,
        });
    };

    #[cfg(target_os = "macos")]
    let definition = macos::copy_text_definition(&sanitized);

    #[cfg(not(target_os = "macos"))]
    let definition = None;

    Ok(DictionaryLookupResult {
        term: sanitized,
        definition,
    })
}

#[cfg(test)]
mod tests {
    use super::sanitize_dictionary_term;

    #[test]
    fn sanitize_rejects_empty_and_overlong_terms() {
        assert_eq!(sanitize_dictionary_term("   "), None);
        assert_eq!(sanitize_dictionary_term(""), None);
        let too_long = "a".repeat(65);
        assert_eq!(sanitize_dictionary_term(&too_long), None);
    }

    #[test]
    fn sanitize_collapses_whitespace() {
        assert_eq!(
            sanitize_dictionary_term("  aurora   book  "),
            Some("aurora book".to_string())
        );
    }
}
