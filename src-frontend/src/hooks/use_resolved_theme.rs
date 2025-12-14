use leptos::*;
use crate::types::settings::UITheme;
use wasm_bindgen::{prelude::*, closure::Closure};

/// Resolves a UI theme to either "light" or "dark".
/// If theme is "system", it checks the user's system preference and listens for changes.
pub fn use_resolved_theme(theme: Memo<UITheme>) -> ReadSignal<UITheme> {
    let (resolved_theme, set_resolved_theme) = create_signal(resolve_theme_initial(theme.get_untracked()));
    
    // Update when theme changes
    create_effect(move |_| {
        let current_theme = theme.get();
        
        if current_theme != UITheme::System {
            // Direct theme - no system listener needed
            set_resolved_theme.set(current_theme);
            return;
        }
        
        // System theme - need to listen to OS changes
        let window = web_sys::window().unwrap();
        let media_query = window
            .match_media("(prefers-color-scheme: dark)")
            .ok()
            .flatten();
        
        if let Some(media) = media_query {
            // Set initial value
            let is_dark = media.matches();
            set_resolved_theme.set(if is_dark { UITheme::Dark } else { UITheme::Light });
            
            // Listen for changes
            let set_resolved = set_resolved_theme.clone();
            let closure = Closure::wrap(Box::new(move |_| {
                let window = web_sys::window().unwrap();
                if let Ok(Some(media)) = window.match_media("(prefers-color-scheme: dark)") {
                    let is_dark = media.matches();
                    set_resolved.set(if is_dark { UITheme::Dark } else { UITheme::Light });
                }
            }) as Box<dyn FnMut(JsValue)>);
            
            media.set_onchange(Some(closure.as_ref().unchecked_ref()));
            
            // Cleanup on effect re-run
            on_cleanup(move || {
                media.set_onchange(None);
                closure.forget(); // Cleanup closure
            });
        }
    });
    
    resolved_theme
}

fn resolve_theme_initial(theme: UITheme) -> UITheme {
    if theme == UITheme::System {
        let window = web_sys::window();
        if let Some(window) = window {
            if let Ok(Some(media)) = window.match_media("(prefers-color-scheme: dark)") {
                if media.matches() {
                    return UITheme::Dark;
                }
            }
        }
        UITheme::Light
    } else {
        theme
    }
}
