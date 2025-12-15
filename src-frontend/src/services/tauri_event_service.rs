use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen::closure::Closure;
use wasm_bindgen_futures::JsFuture;
use js_sys::{Promise, Function, Reflect};
use serde::Deserialize;
use serde_wasm_bindgen;

/// Listen to a Tauri event
/// Returns a cleanup function that can be called to unlisten
/// Note: The callback closure will be kept alive until unlisten is called
pub async fn listen_tauri_event<T>(
    event_name: &str,
    callback: impl Fn(T) + 'static,
) -> Result<Box<dyn Fn()>, String>
where
    T: for<'de> Deserialize<'de>,
{
    let window = web_sys::window().ok_or("No window object")?;
    let tauri = Reflect::get(&window, &JsValue::from_str("__TAURI__"))
        .map_err(|_| "Tauri not available")?;
    
    let event = Reflect::get(&tauri, &JsValue::from_str("event"))
        .map_err(|_| "Tauri event API not available")?;
    
    let listen_fn = Reflect::get(&event, &JsValue::from_str("listen"))
        .map_err(|_| "Tauri listen function not available")?;
    
    let listen = listen_fn.dyn_ref::<Function>()
        .ok_or("listen is not a function")?;
    
    // Create a closure that will be called by Tauri
    // We need to move the callback into the closure and keep it alive
    let callback_boxed = Box::new(callback);
    let callback_js = Closure::wrap(Box::new(move |event: JsValue| {
        // Extract payload from event
        let payload = Reflect::get(&event, &JsValue::from_str("payload"))
            .unwrap_or(JsValue::NULL);
        
        // Deserialize payload
        if let Ok(deserialized) = serde_wasm_bindgen::from_value::<T>(payload) {
            callback_boxed(deserialized);
        } else {
            web_sys::console::warn_1(&format!("Failed to deserialize event payload for {}", event_name).into());
        }
    }) as Box<dyn FnMut(JsValue)>);
    
    // Call listen(event_name, callback)
    let promise = listen
        .call2(
            &event,
            &JsValue::from_str(event_name),
            callback_js.as_ref().unchecked_ref(),
        )
        .map_err(|_| "Failed to call listen")?;
    
    let promise = Promise::from(promise);
    let result = JsFuture::from(promise)
        .await
        .map_err(|e| format!("Listen promise failed: {:?}", e))?;
    
    // Extract unlisten function from result
    let unlisten_fn = Reflect::get(&result, &JsValue::from_str("unlisten"))
        .or_else(|_| Reflect::get(&result, &JsValue::from_str("unlistenFn")))
        .map_err(|_| "No unlisten function in result")?;
    
    let unlisten = unlisten_fn.dyn_ref::<Function>()
        .ok_or("unlisten is not a function")?;
    
    // Store unlisten function as JsValue so it can be moved into the cleanup closure
    // The callback closure will be kept alive by Tauri's event system
    // We return a cleanup function that calls unlisten
    let unlisten_jsval = JsValue::from(unlisten.as_ref() as &js_sys::Function);
    let cleanup: Box<dyn Fn()> = Box::new(move || {
        if let Some(unlisten_fn) = unlisten_jsval.dyn_ref::<Function>() {
            let _ = unlisten_fn.call0(&JsValue::NULL);
        }
    });
    
    // Keep callback alive - it will be cleaned up when unlisten is called
    callback_js.forget();
    
    Ok(cleanup)
}

