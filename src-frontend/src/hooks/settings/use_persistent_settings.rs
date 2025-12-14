use leptos::*;
use crate::types::settings::AppSettings;
use crate::services::settings_service::{get_app_settings, update_app_settings, default_settings};
use leptos::spawn_local;

/// Hook for persisting app settings to backend database
/// Returns: (settings, is_hydrated, update_settings)
pub fn use_persistent_settings() -> (
    RwSignal<AppSettings>,
    ReadSignal<bool>,
    Callback<AppSettings>,
) {
    let settings = create_rw_signal(default_settings());
    let (is_hydrated, set_is_hydrated) = create_signal(false);
    
    // Load settings on mount
    create_effect(move |_| {
        if !is_hydrated.get() {
            spawn_local(async move {
                match get_app_settings().await {
                    Ok(loaded_settings) => {
                        settings.set(loaded_settings);
                        set_is_hydrated.set(true);
                    }
                    Err(e) => {
                        web_sys::console::warn_1(&format!("[SettingsPersistence]: failed to load settings from backend, using defaults: {}", e).into());
                        set_is_hydrated.set(true);
                    }
                }
            });
        }
    });
    
    // Update settings function
    let update_settings = Callback::new(move |update: AppSettings| {
        let settings_clone = update.clone();
        settings.set(update);
        
        // Persist to backend asynchronously
        spawn_local(async move {
            if let Err(e) = update_app_settings(&settings_clone).await {
                web_sys::console::warn_1(&format!("[SettingsPersistence]: failed to persist settings: {}", e).into());
            }
        });
    });
    
    (settings, is_hydrated, update_settings)
}
