use leptos::*;
use wasm_bindgen::prelude::*;

pub mod app;
pub mod types;
pub mod services;
pub mod components;
pub mod constants;
pub mod hooks;

use app::App;

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
    
    // Initialize tracing for better debugging
    tracing_wasm::set_as_global_default();
    
    mount_to_body(|| {
        view! {
            <App />
        }
    })
}
