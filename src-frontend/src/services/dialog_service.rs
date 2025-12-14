use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use js_sys::Promise;

/// Open a file dialog to select an EPUB file
pub async fn open_file_dialog() -> Result<Option<String>, String> {
    let window = web_sys::window().ok_or("No window object")?;
    let tauri = js_sys::Reflect::get(&window, &JsValue::from_str("__TAURI__"))
        .map_err(|_| "Tauri not available")?;
    
    let dialog = js_sys::Reflect::get(&tauri, &JsValue::from_str("dialog"))
        .map_err(|_| "Tauri dialog not available")?;
    
    let open_fn = js_sys::Reflect::get(&dialog, &JsValue::from_str("open"))
        .map_err(|_| "Tauri dialog.open not available")?;
    
    let open = open_fn.dyn_ref::<js_sys::Function>()
        .ok_or("open is not a function")?;
    
    // Build dialog options
    let options = js_sys::Object::new();
    js_sys::Reflect::set(&options, &"multiple".into(), &JsValue::from_bool(false)).ok();
    
    // Add filters for EPUB files
    let filters = js_sys::Array::new();
    let filter = js_sys::Object::new();
    js_sys::Reflect::set(&filter, &"name".into(), &JsValue::from_str("EPUB files")).ok();
    let extensions = js_sys::Array::new();
    extensions.push(&JsValue::from_str("epub"));
    js_sys::Reflect::set(&filter, &"extensions".into(), &extensions).ok();
    filters.push(&filter);
    js_sys::Reflect::set(&options, &"filters".into(), &filters).ok();
    
    let promise = open
        .call1(&dialog, &options)
        .map_err(|_| "Failed to call dialog.open")?;
    
    let promise = Promise::from(promise);
    let result = JsFuture::from(promise)
        .await
        .map_err(|e| format!("Dialog failed: {:?}", e))?;
    
    // Handle the result - it can be null, a string, or an array
    if result.is_null() || result.is_undefined() {
        return Ok(None);
    }
    
    // If it's a string, return it
    if let Some(path) = result.as_string() {
        return Ok(Some(path));
    }
    
    // If it's an array, get the first element
    let array = js_sys::Array::from(&result);
    if array.length() > 0 {
        if let Some(path) = array.get(0).as_string() {
            return Ok(Some(path));
        }
    }
    
    Ok(None)
}

/// Open a save dialog to save a file
pub async fn save_file_dialog(default_path: &str, filters: Option<Vec<(&str, Vec<&str>)>>) -> Result<Option<String>, String> {
    let window = web_sys::window().ok_or("No window object")?;
    let tauri = js_sys::Reflect::get(&window, &JsValue::from_str("__TAURI__"))
        .map_err(|_| "Tauri not available")?;
    
    let dialog = js_sys::Reflect::get(&tauri, &JsValue::from_str("dialog"))
        .map_err(|_| "Tauri dialog not available")?;
    
    let save_fn = js_sys::Reflect::get(&dialog, &JsValue::from_str("save"))
        .map_err(|_| "Tauri dialog.save not available")?;
    
    let save = save_fn.dyn_ref::<js_sys::Function>()
        .ok_or("save is not a function")?;
    
    // Build dialog options
    let options = js_sys::Object::new();
    js_sys::Reflect::set(&options, &"defaultPath".into(), &JsValue::from_str(default_path)).ok();
    
    // Add filters if provided
    if let Some(filter_list) = filters {
        let filters_array = js_sys::Array::new();
        for (name, extensions) in filter_list {
            let filter = js_sys::Object::new();
            js_sys::Reflect::set(&filter, &"name".into(), &JsValue::from_str(name)).ok();
            let extensions_array = js_sys::Array::new();
            for ext in extensions {
                extensions_array.push(&JsValue::from_str(ext));
            }
            js_sys::Reflect::set(&filter, &"extensions".into(), &extensions_array).ok();
            filters_array.push(&filter);
        }
        js_sys::Reflect::set(&options, &"filters".into(), &filters_array).ok();
    }
    
    let promise = save
        .call1(&dialog, &options)
        .map_err(|_| "Failed to call dialog.save")?;
    
    let promise = Promise::from(promise);
    let result = JsFuture::from(promise)
        .await
        .map_err(|e| format!("Save dialog failed: {:?}", e))?;
    
    // Handle the result - it can be null, a string, or undefined
    if result.is_null() || result.is_undefined() {
        return Ok(None);
    }
    
    // If it's a string, return it
    if let Some(path) = result.as_string() {
        return Ok(Some(path));
    }
    
    Ok(None)
}
