use leptos::*;
use crate::components::ui::utils::cn;
use gloo_timers::callback::Timeout;

#[derive(Clone, Copy, PartialEq)]
pub enum ButtonVariant {
    Default,
    Destructive,
    Outline,
    Secondary,
    Ghost,
    Link,
}

#[derive(Clone, Copy, PartialEq)]
pub enum ButtonSize {
    Default,
    Sm,
    Lg,
    Icon,
}

fn button_variant_classes(variant: ButtonVariant) -> &'static str {
    match variant {
        ButtonVariant::Default => "bg-primary text-primary-foreground hover:bg-primary/90",
        ButtonVariant::Destructive => "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        ButtonVariant::Outline => "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ButtonVariant::Secondary => "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ButtonVariant::Ghost => "hover:bg-accent hover:text-accent-foreground",
        ButtonVariant::Link => "text-primary underline-offset-4 hover:underline",
    }
}

fn button_size_classes(size: ButtonSize) -> &'static str {
    match size {
        ButtonSize::Default => "h-10 px-4 py-2",
        ButtonSize::Sm => "h-9 rounded-md px-3",
        ButtonSize::Lg => "h-11 rounded-md px-8",
        ButtonSize::Icon => "h-10 w-10",
    }
}

#[component]
pub fn Button(
    #[prop(optional)] variant: Option<ButtonVariant>,
    #[prop(optional)] size: Option<ButtonSize>,
    #[prop(optional)] class: Option<&'static str>,
    #[prop(optional)] disabled: Option<ReadSignal<bool>>,
    #[prop(optional)] on_click: Option<Callback<()>>,
    children: Children,
) -> impl IntoView {
    let variant = variant.unwrap_or(ButtonVariant::Default);
    let size = size.unwrap_or(ButtonSize::Default);
    let disabled_signal = disabled;
    
    let (ripple_active, set_ripple_active) = create_signal(false);
    
    let base_classes = "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background disabled:pointer-events-none disabled:opacity-50 relative overflow-hidden";
    let variant_classes = button_variant_classes(variant);
    let size_classes = button_size_classes(size);
    let hover_class = "transition-colors";
    let ripple_class = move || {
        if ripple_active.get_untracked() {
            "button-ripple ripple-active"
        } else {
            ""
        }
    };
    
    let classes = cn(&[
        base_classes,
        variant_classes,
        size_classes,
        hover_class,
        &ripple_class(),
        class.unwrap_or(""),
    ]);
    
    let is_disabled = move || {
        disabled_signal.map(|s| s.get()).unwrap_or(false)
    };
    
    let handle_click = move |_| {
        if !is_disabled() {
            // Trigger ripple effect for primary and destructive buttons
            if matches!(variant, ButtonVariant::Default | ButtonVariant::Destructive) {
                set_ripple_active.set(true);
                let _timeout = Timeout::new(600, move || {
                    set_ripple_active.set(false);
                });
            }
            
            if let Some(cb) = on_click {
                cb.call(());
            }
        }
    };
    
    view! {
        <button
            class=classes
            disabled=move || is_disabled()
            on:click=handle_click
        >
            {children()}
        </button>
    }
}
