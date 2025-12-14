use leptos::*;
use crate::components::ui::utils::cn;

#[component]
pub fn Progress(
    #[prop(optional)] value: Option<f64>,
    #[prop(optional)] max: Option<f64>,
    #[prop(optional)] animated: Option<bool>,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    let value = value.unwrap_or(0.0);
    let max = max.unwrap_or(100.0);
    let animated = animated.unwrap_or(true);
    
    let percentage = (value / max * 100.0).min(100.0).max(0.0);
    
    let base_classes = "relative h-2 w-full overflow-hidden rounded-full bg-secondary";
    let classes = cn(&[base_classes, class.unwrap_or("")]);
    
    let fill_classes = if animated {
        "h-full bg-primary transition-[width] duration-300 ease-in-out"
    } else {
        "h-full bg-primary"
    };
    
    view! {
        <div class=classes role="progressbar" aria-valuenow=value aria-valuemin=0.0 aria-valuemax=max>
            <div
                class=fill_classes
                style=format!("width: {}%", percentage)
            />
        </div>
    }
}
