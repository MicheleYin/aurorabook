use leptos::*;

#[component]
pub fn ScrollArea(
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    let class_str = class.unwrap_or("");
    
    view! {
        <div class=format!("overflow-auto pr-2 min-w-0 w-full {}", class_str)>
            {children()}
        </div>
    }
}


