use tauri::{AppHandle, WebviewWindow};

/// Window state information
#[derive(Debug, Clone)]
pub struct WindowState {
    pub size: (f64, f64),
    // pub position: Option<(f64, f64)>,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            size: (800.0, 600.0),
            // position: None,
            maximized: false,
        }
    }
}

/// Load window state from persistent store
pub fn load_window_state(app: &AppHandle) -> WindowState {
    let store_result = tauri_plugin_store::StoreBuilder::new(
        app,
        "window-state.json"
    ).build();
    
    let mut state = WindowState::default();
    
    // Try to load saved window state
    if let Ok(store) = store_result {
        if let Some(saved_state) = store.get("main_window_state") {
            if let Some(size) = saved_state.get("size") {
                if let (Some(w), Some(h)) = (
                    size.get("width").and_then(|v| v.as_f64()),
                    size.get("height").and_then(|v| v.as_f64()),
                ) {
                    // Validate size is reasonable
                    if w >= 300.0 && h >= 300.0 && w <= 10000.0 && h <= 10000.0 {
                        state.size = (w, h);
                    }
                }
            }
            // if let Some(pos) = saved_state.get("position") {
            //     if let (Some(x), Some(y)) = (
            //         pos.get("x").and_then(|v| v.as_f64()),
            //         pos.get("y").and_then(|v| v.as_f64()),
            //     ) {
            //         // Validate position is reasonable
            //         if x >= -10000.0 && x <= 10000.0 && y >= -10000.0 && y <= 10000.0 {
            //             state.position = Some((x, y));
            //         }
            //     }
            // }
            if let Some(max) = saved_state.get("maximized").and_then(|v| v.as_bool()) {
                state.maximized = max;
            }
        }
    }
    
    state
}

/// Save window state to persistent store
pub fn save_window_state(window: &WebviewWindow, app: &AppHandle) {
    if let Ok(store) = tauri_plugin_store::StoreBuilder::new(
        app,
        "window-state.json"
    ).build() {
        if let Ok(size) = window.inner_size() {
            if let Ok(_) = window.outer_position() {
                let state = serde_json::json!({
                    "size": {
                        "width": size.width as f64,
                        "height": size.height as f64,
                    },
                    // "position": {
                    //     "x": position.x as f64,
                    //     "y": position.y as f64,
                    // },
                    "maximized": window.is_maximized().unwrap_or(false),
                });
                
                store.set("main_window_state", state);
                if let Err(e) = store.save() {
                    log::warn!("Failed to persist window state: {}", e);
                }
            }
        }
    }
}

/// Create and configure the main window with state restoration
pub fn create_main_window(app: &tauri::App) -> Result<WebviewWindow, String> {
    // Load saved window state
    let window_state = load_window_state(app.handle());
    
    // Create the main window programmatically
    let mut win_builder = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::default()
    );
    
    // Configure window properties only on non-iOS platforms
    // iOS has limited window API support
    #[cfg(not(target_os = "ios"))]
    {
        win_builder = win_builder
            .title("AuroraBook")
            .inner_size(window_state.size.0, window_state.size.1)
            .min_inner_size(300.0, 300.0);
    }

    // Set transparent title bar only when building for macOS
    #[cfg(target_os = "macos")]
    {
        win_builder = win_builder.title_bar_style(tauri::TitleBarStyle::Transparent);
    }

    let window = win_builder.build().map_err(|e| {
        format!("Failed to create window: {}", e)
    })?;

    // Restore window state only on non-iOS platforms
    #[cfg(not(target_os = "ios"))]
    {
        // Restore window position if available
        // if let Some((x, y)) = window_state.position {
        //     if let Err(e) = window.set_position(tauri::LogicalPosition::new(x, y)) {
        //         log::warn!("Failed to restore window position: {}", e);
        //     }
        // }
        
        // Restore maximized state if it was maximized
        if window_state.maximized {
            if let Err(e) = window.maximize() {
                log::warn!("Failed to restore maximized state: {}", e);
            }
        }
    }

    // Set background color only when building for macOS
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::{NSColor, NSWindow};
        use cocoa::base::{id, nil};

        let ns_window = window.ns_window().unwrap() as id;
        unsafe {
            // Use white background (light mode default)
            // HSL: 0 0% 100% -> RGB: 255, 255, 255
            let bg_color = NSColor::colorWithRed_green_blue_alpha_(
                nil,
                0.97,  // Red: 255/255
                0.97,  // Green: 255/255
                0.97,  // Blue: 255/255
                1.0,  // Alpha: 1.0 (fully opaque)
            );
            ns_window.setBackgroundColor_(bg_color);
        }
    }
    
    // Set up window state saving on close
    let window_clone = window.clone();
    let app_handle = app.handle().clone();
    
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            save_window_state(&window_clone, &app_handle);
        }
    });

    Ok(window)
}

