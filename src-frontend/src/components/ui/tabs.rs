use leptos::*;
use crate::components::ui::utils::cn;

#[component]
pub fn Tabs(
    #[prop(optional)] default_value: Option<&'static str>,
    #[prop(optional)] value: Option<ReadSignal<String>>,
    #[prop(optional)] on_value_change: Option<Callback<String>>,
    children: Children,
) -> impl IntoView {
    let internal_value = create_rw_signal(
        value.map(|v| v.get()).unwrap_or_else(|| default_value.unwrap_or("").to_string())
    );
    
    // Sync with external value if provided
    if let Some(ext_value) = value {
        create_effect(move |_| {
            internal_value.set(ext_value.get());
        });
    }
    
    let handle_value_change = move |new_value: String| {
        internal_value.set(new_value.clone());
        if let Some(cb) = on_value_change {
            cb.call(new_value);
        }
    };
    
    provide_context(TabsContext {
        value: internal_value,
        set_value: Callback::new(move |v: String| handle_value_change(v)),
    });
    
    view! {
        <div>
            {children()}
        </div>
    }
}

#[derive(Clone)]
struct TabsContext {
    value: RwSignal<String>,
    set_value: Callback<String>,
}

fn use_tabs_context() -> TabsContext {
    use_context().expect("Tabs components must be used within a Tabs component")
}

#[component]
pub fn TabsList(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let classes = cn(&[
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        class.unwrap_or(""),
    ]);
    
    view! {
        <div class=classes role="tablist">
            {children()}
        </div>
    }
}

#[component]
pub fn TabsTrigger(
    value: &'static str,
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let context = use_tabs_context();
    let is_active = move || context.value.get() == value;
    
    let base_classes = "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
    let active_classes = move || {
        if is_active() {
            "bg-background text-foreground shadow-sm"
        } else {
            ""
        }
    };
    
    let classes = cn(&[base_classes, &active_classes(), class.unwrap_or("")]);
    
    let handle_click = move |_| {
        context.set_value.call(value.to_string());
    };
    
    view! {
        <button
            class=classes
            role="tab"
            aria-selected=is_active()
            on:click=handle_click
        >
            {children()}
        </button>
    }
}

#[component]
pub fn TabsContent(
    value: &'static str,
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let context = use_tabs_context();
    let is_active = move || context.value.get() == value;
    
    let classes = cn(&[
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        class.unwrap_or(""),
    ]);
    
    view! {
        <div
            class=classes
            role="tabpanel"
            hidden=move || !is_active()
        >
            {children()}
        </div>
    }
}
