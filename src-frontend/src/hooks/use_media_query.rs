use leptos::*;
use wasm_bindgen::{prelude::*, closure::Closure};

/// Hook to detect if a media query matches
/// Returns a ReadSignal<bool> that updates when the media query match state changes
pub fn use_media_query(query: &'static str) -> ReadSignal<bool> {
    let (matches, set_matches) = create_signal(false);
    
    create_effect(move |_| {
        let window = web_sys::window().expect("window should be available");
        let media_query = window
            .match_media(query)
            .ok()
            .flatten()
            .expect("media query should be available");
        
        // Set initial value
        set_matches.set(media_query.matches());
        
        // Listen for changes
        let set_matches_clone = set_matches.clone();
        let media_query_for_closure = media_query.clone();
        let closure = Closure::wrap(Box::new(move |_| {
            set_matches_clone.set(media_query_for_closure.matches());
        }) as Box<dyn FnMut(JsValue)>);
        
        media_query.set_onchange(Some(closure.as_ref().unchecked_ref()));
        
        // Cleanup on effect re-run
        let media_query_for_cleanup = media_query.clone();
        on_cleanup(move || {
            media_query_for_cleanup.set_onchange(None);
            closure.forget(); // Cleanup closure
        });
    });
    
    matches
}
