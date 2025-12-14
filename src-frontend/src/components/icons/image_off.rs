use leptos::*;

#[component]
pub fn ImageOff(
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
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M10.5 10.5a2.5 2.5 0 0 0 0 0" />
            <path d="M21 15V5a2 2 0 0 0-2-2H5" />
            <path d="m3 3 18 18" />
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
            <path d="m2 2 20 20" />
        </svg>
    }
}
