use leptos::*;
use crate::components::ui::utils::cn;
use wasm_bindgen::JsCast;

#[component]
pub fn Slider(
    #[prop(optional)] value: Option<ReadSignal<Vec<f64>>>,
    #[prop(optional)] min: Option<f64>,
    #[prop(optional)] max: Option<f64>,
    #[prop(optional)] step: Option<f64>,
    #[prop(optional)] class: Option<&'static str>,
    #[prop(optional)] on_value_change: Option<Callback<Vec<f64>>>,
    #[prop(optional)] disabled: Option<bool>,
) -> impl IntoView {
    let min = min.unwrap_or(0.0);
    let max = max.unwrap_or(100.0);
    let step = step.unwrap_or(1.0);
    let disabled = disabled.unwrap_or(false);
    
    let (internal_value, set_internal_value) = create_signal(
        value.map(|v| v.get()).unwrap_or_else(|| vec![min])
    );
    
    // Sync with external value if provided
    if let Some(ext_value) = value {
        create_effect(move |_| {
            set_internal_value.set(ext_value.get());
        });
    }
    
    let current_value = move || internal_value.get().first().copied().unwrap_or(min);
    
    let handle_input = move |ev: web_sys::Event| {
        if let Some(target) = ev.target() {
            if let Some(input) = target.dyn_ref::<web_sys::HtmlInputElement>() {
                if let Ok(new_value) = input.value().parse::<f64>() {
                    let clamped = new_value.min(max).max(min);
                    let new_values = vec![clamped];
                    set_internal_value.set(new_values.clone());
                    if let Some(cb) = on_value_change {
                        cb.call(new_values);
                    }
                }
            }
        }
    };
    
    let percentage = move || {
        let val = current_value();
        ((val - min) / (max - min) * 100.0).min(100.0).max(0.0)
    };
    
    let base_classes = "relative flex w-full touch-none select-none items-center";
    let classes = cn(&[base_classes, class.unwrap_or("")]);
    
    view! {
        <div class=classes>
            <div class="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
                <div
                    class="absolute h-full bg-primary"
                    style=move || format!("width: {}%", percentage())
                />
            </div>
            <input
                type="range"
                min=min
                max=max
                step=step
                value=move || current_value()
                disabled=disabled
                on:input=handle_input
                class="absolute h-4 w-4 rounded-full border border-primary/20 bg-background shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                style="appearance: none; background: transparent; cursor: pointer;"
            />
        </div>
    }
}
