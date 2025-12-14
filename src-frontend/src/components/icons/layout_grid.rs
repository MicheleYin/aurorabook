use leptos::*;

#[component]
pub fn LayoutGrid(
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
            <rect width="7" height="7" x="3" y="3" rx="1" />
            <rect width="7" height="7" x="14" y="3" rx="1" />
            <rect width="7" height="7" x="14" y="14" rx="1" />
            <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
    }
}
