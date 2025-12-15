use leptos::*;
use crate::components::icons::X;

#[component]
pub fn Dialog(
    open: ReadSignal<bool>,
    on_open_change: Callback<bool>,
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
    #[prop(optional)] z_index: Option<&'static str>,
) -> impl IntoView {
    let class_str = class.unwrap_or("");
    let z_index_str = z_index.unwrap_or("z-50");
    let on_close = on_open_change.clone();
    let children_rendered = children();
    
    view! {
        {move || {
            if !open.get() {
                return view! {}.into_view();
            }
            let on_close_clone = on_close.clone();
            let class_str_clone = class_str.to_string();
            let z_index_clone = z_index_str.to_string();
            let z_index_overlay = if z_index_str == "z-[100]" { "z-[90]" } else { "z-40" };
            let children_clone = children_rendered.clone();
            view! {
                <div class=format!("fixed inset-0 {} flex items-center justify-center", z_index_clone)>
                    <div
                        class=format!("fixed inset-0 {} bg-background/60 backdrop-blur-sm sm:backdrop-blur-md animate-in fade-in-0 dialog-overlay", z_index_overlay)
                        on:click=move |_| {
                            on_close_clone.call(false);
                        }
                    ></div>
                    <div
                        class=format!(
                            "relative {} flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-hidden rounded-3xl border bg-card p-6 shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-[48%] {}",
                            z_index_clone,
                            class_str_clone
                        )
                        on:click=move |ev| {
                            ev.stop_propagation();
                        }
                    >
                        <div class="flex-1 overflow-y-auto -mx-6 px-6">
                            <div class="flex flex-col gap-4">
                                {children_clone}
                            </div>
                        </div>
                    </div>
                </div>
            }.into_view()
        }}
    }
}

#[component]
pub fn DialogHeader(
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    view! {
        <div class=format!("flex flex-col space-y-1.5 text-center sm:text-left {}", class.unwrap_or(""))>
            {children()}
        </div>
    }
}

#[component]
pub fn DialogTitle(
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    view! {
        <h2 class=format!("text-lg font-semibold leading-none tracking-tight {}", class.unwrap_or(""))>
            {children()}
        </h2>
    }
}

#[component]
pub fn DialogDescription(
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    view! {
        <p class=format!("text-sm text-muted-foreground {}", class.unwrap_or(""))>
            {children()}
        </p>
    }
}

#[component]
pub fn DialogFooter(
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    view! {
        <div class=format!("flex flex-col-reverse flex-wrap gap-2 sm:flex-row sm:justify-end sm:space-x-2 {}", class.unwrap_or(""))>
            {children()}
        </div>
    }
}

#[component]
pub fn DialogClose(
    on_click: Callback<()>,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    view! {
        <button
            type="button"
            class=format!("absolute right-4 top-4 z-10 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none transition-opacity {}", class.unwrap_or(""))
            on:click=move |_| on_click.call(())
            aria-label="Close dialog"
        >
            <X size=16 />
            <span class="sr-only">"Close"</span>
        </button>
    }
}
