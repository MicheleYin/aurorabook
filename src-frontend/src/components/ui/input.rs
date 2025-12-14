use leptos::*;
use crate::components::ui::utils::cn;
use wasm_bindgen::JsCast;

#[component]
pub fn Input(
    #[prop(optional)] input_type: Option<&'static str>,
    #[prop(optional)] placeholder: Option<&'static str>,
    #[prop(optional)] value: Option<ReadSignal<String>>,
    #[prop(optional)] class: Option<&'static str>,
    #[prop(optional)] disabled: Option<bool>,
    #[prop(optional)] on_input: Option<Callback<String>>,
) -> impl IntoView {
    let input_type = input_type.unwrap_or("text");
    let disabled = disabled.unwrap_or(false);
    
    let base_classes = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
    
    let classes = cn(&[base_classes, class.unwrap_or("")]);
    
    let handle_input = move |ev: web_sys::Event| {
        if let Some(target) = ev.target() {
            if let Some(input) = target.dyn_ref::<web_sys::HtmlInputElement>() {
                let value = input.value();
                if let Some(cb) = on_input {
                    cb.call(value);
                }
            }
        }
    };
    
    view! {
        <input
            type=input_type
            class=classes
            placeholder=placeholder
            prop:value=move || value.map(|v| v.get()).unwrap_or_default()
            disabled=disabled
            on:input=handle_input
        />
    }
}
