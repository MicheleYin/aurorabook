use leptos::*;

#[component]
pub fn Headphones(
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
            <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
        </svg>
    }
}


