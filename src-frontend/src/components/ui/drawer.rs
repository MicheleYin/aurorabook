use leptos::*;
use crate::components::icons::X;
use crate::components::ui::Button;
use crate::components::ui::ButtonVariant;
use crate::components::ui::ButtonSize;

#[component]
pub fn Drawer(
    open: ReadSignal<bool>,
    on_open_change: Callback<bool>,
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    let class_str = class.unwrap_or("");
    let on_close = on_open_change.clone();
    let children_rendered = children();
    
    view! {
        {move || {
            if !open.get() {
                return view! {}.into_view();
            }
            let on_close_clone = on_close.clone();
            let class_str_clone = class_str.to_string();
            let children_clone = children_rendered.clone();
            view! {
                <div class="fixed inset-0 z-50">
                    <div
                        class="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm sm:backdrop-blur-md animate-in fade-in-0 drawer-overlay"
                        on:click=move |_| {
                            on_close_clone.call(false);
                        }
                    ></div>
                    <div
                        class=move || {
                            // Check if class contains left drawer positioning
                            if class_str_clone.contains("left-0") || class_str_clone.contains("inset-y-0") {
                                format!(
                                    "fixed z-50 flex h-full w-full flex-col border bg-card shadow-lg outline-none animate-in fade-in-0 {}",
                                    class_str_clone
                                )
                            } else {
                                format!(
                                    "fixed inset-x-0 bottom-0 z-50 flex h-auto max-h-[90vh] w-full flex-col rounded-t-3xl border bg-card p-6 shadow-lg outline-none animate-in slide-in-from-bottom fade-in-0 drawer-slide-in-bottom {}",
                                    class_str_clone
                                )
                            }
                        }
                        on:click=move |ev| {
                            ev.stop_propagation();
                        }
                    >
                        <div class="mx-auto flex w-full flex-1 flex-col overflow-hidden min-w-0">
                            {children_clone}
                        </div>
                    </div>
                </div>
            }.into_view()
        }}
    }
}

#[component]
pub fn DrawerHandle() -> impl IntoView {
    view! {
        <div class="mx-auto mb-4 h-2 w-20 rounded-full bg-muted touch-none"></div>
    }
}

#[component]
pub fn DrawerHeader(
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    view! {
        <div class=format!("grid gap-1.5 text-center sm:text-left {}", class.unwrap_or(""))>
            {children()}
        </div>
    }
}

#[component]
pub fn DrawerTitle(
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
pub fn DrawerDescription(
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
pub fn DrawerFooter(
    children: Children,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    view! {
        <div class=format!("mt-auto flex flex-col flex-wrap gap-2 sm:flex-row sm:justify-end {}", class.unwrap_or(""))>
            {children()}
        </div>
    }
}

#[component]
pub fn DrawerClose(
    on_click: Callback<()>,
) -> impl IntoView {
    view! {
        <Button
            variant=ButtonVariant::Ghost
            size=ButtonSize::Icon
            on_click=Callback::new(move |_| on_click.call(()))
        >
            <X size=16 />
            <span class="sr-only">"Close"</span>
        </Button>
    }
}
