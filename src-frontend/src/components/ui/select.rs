use leptos::*;
use crate::components::icons::{ChevronDown, Check};

#[derive(Clone, Copy, PartialEq)]
pub enum SelectPosition {
    Popper,
    ItemAligned,
}

#[component]
pub fn Select(
    value: String,
    on_value_change: Callback<String>,
    children: Children,
) -> impl IntoView {
    let (open, set_open) = create_signal(false);
    let (selected_value, set_selected_value) = create_signal(value.clone());
    
    // Update selected value when prop changes
    create_effect(move |_| {
        set_selected_value.set(value.clone());
    });
    
    provide_context(SelectContext {
        open,
        set_open,
        selected_value,
        set_selected_value: Callback::new(move |val: String| {
            set_selected_value.set(val.clone());
            on_value_change.call(val);
            set_open.set(false);
        }),
    });
    
    children()
}

#[derive(Clone)]
struct SelectContext {
    open: ReadSignal<bool>,
    set_open: WriteSignal<bool>,
    selected_value: ReadSignal<String>,
    set_selected_value: Callback<String>,
}

fn use_select_context() -> SelectContext {
    use_context().expect("Select components must be used within a Select root")
}

#[component]
pub fn SelectTrigger(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let ctx = use_select_context();
    let (is_hovered, set_is_hovered) = create_signal(false);
    
    view! {
        <button
            type="button"
            on:click=move |_| {
                ctx.set_open.update(|open| *open = !*open);
            }
            on:mouseenter=move |_| set_is_hovered.set(true)
            on:mouseleave=move |_| set_is_hovered.set(false)
            class=move || {
                let base = format!(
                    "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-in-out {}",
                    class.unwrap_or("")
                );
                if is_hovered.get() && !ctx.open.get() {
                    format!("{} bg-accent/50", base)
                } else {
                    base
                }
            }
        >
            {children()}
            <span class=move || {
                let open = ctx.open.get();
                if open {
                    "opacity-50 transition-all duration-200 rotate-180"
                } else {
                    "opacity-50 transition-all duration-200"
                }
            }>
                <ChevronDown size=16 />
            </span>
        </button>
    }
}

#[component]
pub fn SelectValue(
    #[prop(optional)] placeholder: Option<&'static str>,
) -> impl IntoView {
    let ctx = use_select_context();
    
    view! {
        <span>
            {move || {
                let val = ctx.selected_value.get();
                if val.is_empty() {
                    placeholder.unwrap_or("Select...").to_string()
                } else {
                    val
                }
            }}
        </span>
    }
}

#[component]
pub fn SelectContent(
    #[prop(optional)] class: Option<&'static str>,
    #[prop(optional)] _position: Option<SelectPosition>,
    children: Children,
) -> impl IntoView {
    let ctx = use_select_context();
    let class_str = class.unwrap_or("");
    let children_view = children();
    
    view! {
        {move || {
            if ctx.open.get() {
                view! {
                    <div
                        class=format!(
                            "relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200 {}",
                            class_str
                        )
                        style="position: absolute; top: 100%; left: 0; margin-top: 0.25rem;"
                        on:click=move |e| {
                            e.stop_propagation();
                        }
                    >
                        <div class="max-h-60 overflow-auto p-1">
                            {children_view.clone()}
                        </div>
                    </div>
                }.into_view()
            } else {
                view! { <></> }.into_view()
            }
        }}
    }
}

#[component]
pub fn SelectGroup(
    children: Children,
) -> impl IntoView {
    view! {
        <div class="space-y-1">
            {children()}
        </div>
    }
}

#[component]
pub fn SelectLabel(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    view! {
        <div class=format!(
            "px-2 py-1.5 text-sm font-semibold text-foreground {}",
            class.unwrap_or("")
        )>
            {children()}
        </div>
    }
}

#[component]
pub fn SelectItem(
    value: String,
    #[prop(optional)] class: Option<&'static str>,
    #[prop(optional)] disabled: Option<bool>,
    children: Children,
) -> impl IntoView {
    let ctx = use_select_context();
    let value_for_check = value.clone();
    let value_for_click = value.clone();
    let is_selected = create_memo(move |_| ctx.selected_value.get() == value_for_check);
    let disabled = disabled.unwrap_or(false);
    let (is_hovered, set_is_hovered) = create_signal(false);
    
    view! {
        <div
            on:click=move |_| {
                if !disabled {
                    ctx.set_selected_value.call(value_for_click.clone());
                }
            }
            on:mouseenter=move |_| {
                if !disabled {
                    set_is_hovered.set(true);
                }
            }
            on:mouseleave=move |_| {
                set_is_hovered.set(false);
            }
            class=move || {
                let base = format!(
                    "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-all duration-200 ease-in-out focus:bg-accent focus:text-accent-foreground {}",
                    class.unwrap_or("")
                );
                
                if disabled {
                    format!("{} pointer-events-none opacity-50 cursor-not-allowed", base)
                } else if is_selected.get() {
                    if is_hovered.get() {
                        format!("{} bg-accent text-accent-foreground", base)
                    } else {
                        format!("{} bg-accent/50 text-accent-foreground", base)
                    }
                } else if is_hovered.get() {
                    format!("{} bg-accent/80 text-accent-foreground", base)
                } else {
                    base
                }
            }
        >
            {move || {
                if is_selected.get() {
                    view! {
                        <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                            <Check 
                                size=16
                                class="text-primary animate-in fade-in-0 zoom-in-95 duration-200 transition-all"
                            />
                        </span>
                    }.into_view()
                } else {
                    view! {
                        <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center opacity-0">
                            <Check size=16 />
                        </span>
                    }.into_view()
                }
            }}
            <span class="transition-all duration-200">{children()}</span>
        </div>
    }
}

#[component]
pub fn SelectSeparator(
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    view! {
        <div class=format!(
            "-mx-1 my-1 h-px bg-muted {}",
            class.unwrap_or("")
        )></div>
    }
}
