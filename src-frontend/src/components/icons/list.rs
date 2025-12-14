use leptos::*;

#[component]
pub fn List(
    #[prop(optional)] class: Option<&'static str>,
    #[prop(optional)] size: Option<u32>,
) -> impl IntoView {
    let size = size.unwrap_or(16);
    let class_str = class.unwrap_or("");
    
    view! {
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width=size
            height=size
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class=class_str
            aria-hidden="true"
        >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
    }
}
