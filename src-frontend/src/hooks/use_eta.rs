use leptos::*;
use wasm_bindgen::prelude::*;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use web_sys;

/// Calculate ETA (Estimated Time to Arrival) using exponentially weighted moving average
/// This provides smoother, more stable estimates by giving more weight to recent measurements
/// while still considering historical data.
pub fn use_eta(
    progress_percent: ReadSignal<f64>,
    start_time: ReadSignal<Option<f64>>,
    is_active: ReadSignal<bool>,
) -> ReadSignal<Option<String>> {
    let (eta, set_eta) = create_signal::<Option<String>>(None);
    let smoothed_remaining = create_rw_signal::<Option<f64>>(None);
    let last_progress = create_rw_signal(progress_percent.get());
    let last_update_time = create_rw_signal::<Option<f64>>(None);
    
    let smoothing_factor = 0.3;
    let update_interval = 1000; // 1 second
    
    create_effect(move |_| {
        let is_active_val = is_active.get();
        let start_time_val = start_time.get();
        let progress = progress_percent.get();
        
        // Reset state when inactive or invalid
        if !is_active_val || start_time_val.is_none() || progress <= 0.0 || progress >= 100.0 {
            set_eta.set(None);
            smoothed_remaining.set(None);
            last_progress.set(progress);
            last_update_time.set(None);
            return;
        }
        
        let update_eta = move || {
            let now = js_sys::Date::now();
            let start = start_time_val.unwrap();
            let elapsed = now - start;
            let progress_decimal = progress / 100.0;
            
            if progress_decimal > 0.0 && progress_decimal < 1.0 {
                // Calculate current instantaneous estimate
                let estimated_total = elapsed / progress_decimal;
                let instantaneous_remaining = estimated_total - elapsed;
                
                if instantaneous_remaining > 0.0 {
                    // Apply exponentially weighted moving average
                    let current_smoothed = smoothed_remaining.get();
                    let new_smoothed = if let Some(old) = current_smoothed {
                        // Update with exponentially decaying average
                        smoothing_factor * instantaneous_remaining + (1.0 - smoothing_factor) * old
                    } else {
                        // First measurement: use it directly
                        instantaneous_remaining
                    };
                    
                    smoothed_remaining.set(Some(new_smoothed));
                    
                    // Format and set ETA
                    let formatted = format_eta(new_smoothed);
                    set_eta.set(Some(formatted));
                } else {
                    set_eta.set(None);
                    smoothed_remaining.set(None);
                }
            } else {
                set_eta.set(None);
                smoothed_remaining.set(None);
            }
            
            last_progress.set(progress);
            last_update_time.set(Some(now));
        };
        
        // Update ETA immediately
        update_eta();
        
        // Update ETA at regular intervals using web_sys
        let closure = Closure::wrap(Box::new(move || {
            update_eta();
        }) as Box<dyn FnMut()>);
        
        let interval_id_result = web_sys::window()
            .and_then(|w| {
                match w.set_interval_with_callback_and_timeout_and_arguments_0(
                    closure.as_ref().unchecked_ref(),
                    update_interval
                ) {
                    Ok(id) => Some(id),
                    Err(_) => None,
                }
            });
        
        // Cleanup on effect re-run
        on_cleanup(move || {
            if let Some(interval_id) = interval_id_result {
                if let Some(window) = web_sys::window() {
                    window.clear_interval_with_handle(interval_id);
                }
            }
            closure.forget();
        });
    });
    
    eta
}

/// Format milliseconds into a human-readable ETA string
fn format_eta(remaining_ms: f64) -> String {
    if remaining_ms <= 0.0 {
        return String::new();
    }
    
    let seconds = (remaining_ms / 1000.0) as i32;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    
    if hours > 0 {
        format!("{}h {}m", hours, minutes % 60)
    } else if minutes > 0 {
        format!("{}m {}s", minutes, seconds % 60)
    } else {
        format!("{}s", seconds)
    }
}

