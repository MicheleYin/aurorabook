use leptos::*;
use crate::hooks::use_toast::{use_toast, ToastType, Toast, ToastContext};
use crate::components::icons::{CircleCheck, Info, OctagonX, TriangleAlert, Loader2, X};

#[component]
pub fn Toaster() -> impl IntoView {
    let context = use_context::<ToastContext>()
        .expect("Toaster must be used within a ToastProvider");
    let toasts = context.get_toasts();
    
    view! {
        <div
            class="toaster group fixed top-0 left-1/2 z-[100] flex max-h-screen w-full -translate-x-1/2 flex-col gap-2 p-4 sm:max-w-[420px]"
            style="top: max(env(safe-area-inset-top), 1rem); --border-radius: var(--radius); --normal-bg: hsl(var(--popover)); --normal-border: hsl(var(--border)); --normal-text: hsl(var(--popover-foreground));"
        >
            {move || {
                let toasts_vec: Vec<(String, Toast)> = toasts.get().into_iter().collect();
                toasts_vec.into_iter().map(|(id, toast)| {
                    let toast_id = id.clone();
                    let context_clone = context.clone();
                    view! {
                        <ToastItem
                            toast=toast.clone()
                            on_dismiss=Callback::new(move |_| {
                                context_clone.remove_toast(&toast_id);
                            })
                        />
                    }.into_view()
                }).collect::<Vec<_>>()
            }}
        </div>
    }
}

#[component]
fn ToastItem(
    toast: Toast,
    on_dismiss: Callback<()>,
) -> impl IntoView {
    let (is_visible, set_is_visible) = create_signal(true);
    
    let handle_dismiss = move |_| {
        set_is_visible.set(false);
        // Small delay before removing to allow exit animation
        let on_dismiss_clone = on_dismiss.clone();
        let _timeout = gloo_timers::callback::Timeout::new(200, move || {
            on_dismiss_clone.call(());
        });
    };
    
    let (icon, toast_type_class) = match toast.toast_type {
        ToastType::Success => (
            view! { <CircleCheck size=16 /> }.into_view(),
            "success",
        ),
        ToastType::Error => (
            view! { <OctagonX size=16 /> }.into_view(),
            "error",
        ),
        ToastType::Warning => (
            view! { <TriangleAlert size=16 /> }.into_view(),
            "warning",
        ),
        ToastType::Info => (
            view! { <Info size=16 /> }.into_view(),
            "info",
        ),
        ToastType::Loading => (
            view! { <Loader2 size=16 class="animate-spin" /> }.into_view(),
            "loading",
        ),
    };
    
    view! {
        <div
            data-sonner-toast=""
            data-type=toast_type_class
            data-rich-colors="true"
            class=move || {
                let base = "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none";
                if is_visible.get() {
                    format!("{} animate-in slide-in-from-top-full", base)
                } else {
                    format!("{} animate-out slide-out-to-top-full", base)
                }
            }
            style="border-radius: var(--border-radius); background: var(--normal-bg); border-color: var(--normal-border); color: var(--normal-text);"
            role="alert"
            aria-live="assertive"
        >
            <div class="flex items-start gap-3">
                <div class="flex-shrink-0 mt-0.5" aria-hidden="true">
                    {icon}
                </div>
                <div class="flex-1 space-y-1 min-w-0">
                    <p class="text-sm font-semibold">{toast.title.clone()}</p>
                    {if let Some(description) = &toast.description {
                        view! {
                            <p class="text-sm opacity-90">{description.clone()}</p>
                        }.into_view()
                    } else {
                        view! {}.into_view()
                    }}
                </div>
            </div>
            <button
                type="button"
                on:click=handle_dismiss
                class="absolute right-2 top-2 rounded-md p-1 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
                aria-label="Close"
            >
                <X size=16 />
            </button>
        </div>
    }
}
