use leptos::*;
use crate::types::settings::UITheme;
use crate::components::icons::{Sun, Moon, Monitor};

#[component]
pub fn ThemeSwitcher(
    value: Memo<UITheme>,
    on_change: Callback<UITheme>,
) -> impl IntoView {
    view! {
        <div class="inline-flex items-center gap-1 rounded-lg border border-border bg-card/60 p-1 backdrop-blur">
            // Light theme
            {{
                let theme = UITheme::Light;
                let value_memo = value;
                let on_change_clone = on_change.clone();
                view! {
                    <button
                        type="button"
                        on:click=move |_| on_change_clone.call(theme)
                        class=move || {
                            let is_active = value_memo.get() == theme;
                            if is_active {
                                "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background h-8 w-8 px-0 text-muted-foreground relative overflow-hidden transition-all duration-300 bg-primary/10 text-primary hover:bg-primary/20"
                            } else {
                                "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background h-8 w-8 px-0 text-muted-foreground relative overflow-hidden transition-all duration-300 hover:bg-muted"
                            }
                        }
                    >
                        <span class=move || {
                            let is_active = value_memo.get() == theme;
                            if is_active {
                                "relative z-10 transition-opacity duration-300 opacity-100"
                            } else {
                                "relative z-10 transition-opacity duration-300 opacity-60"
                            }
                        }>
                            <Sun size=16 />
                        </span>
                        <span class="sr-only">"Light"</span>
                    </button>
                }
            }}
            
            // Dark theme
            {{
                let theme = UITheme::Dark;
                let value_memo = value;
                let on_change_clone = on_change.clone();
                view! {
                    <button
                        type="button"
                        on:click=move |_| on_change_clone.call(theme)
                        class=move || {
                            let is_active = value_memo.get() == theme;
                            if is_active {
                                "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background h-8 w-8 px-0 text-muted-foreground relative overflow-hidden transition-all duration-300 bg-primary/10 text-primary hover:bg-primary/20"
                            } else {
                                "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background h-8 w-8 px-0 text-muted-foreground relative overflow-hidden transition-all duration-300 hover:bg-muted"
                            }
                        }
                    >
                        <span class=move || {
                            let is_active = value_memo.get() == theme;
                            if is_active {
                                "relative z-10 transition-opacity duration-300 opacity-100"
                            } else {
                                "relative z-10 transition-opacity duration-300 opacity-60"
                            }
                        }>
                            <Moon size=16 />
                        </span>
                        <span class="sr-only">"Dark"</span>
                    </button>
                }
            }}
            
            // System theme
            {{
                let theme = UITheme::System;
                let value_memo = value;
                let on_change_clone = on_change.clone();
                view! {
                    <button
                        type="button"
                        on:click=move |_| on_change_clone.call(theme)
                        class=move || {
                            let is_active = value_memo.get() == theme;
                            if is_active {
                                "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background h-8 w-8 px-0 text-muted-foreground relative overflow-hidden transition-all duration-300 bg-primary/10 text-primary hover:bg-primary/20"
                            } else {
                                "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background h-8 w-8 px-0 text-muted-foreground relative overflow-hidden transition-all duration-300 hover:bg-muted"
                            }
                        }
                    >
                        <span class=move || {
                            let is_active = value_memo.get() == theme;
                            if is_active {
                                "relative z-10 transition-opacity duration-300 opacity-100"
                            } else {
                                "relative z-10 transition-opacity duration-300 opacity-60"
                            }
                        }>
                            <Monitor size=16 />
                        </span>
                        <span class="sr-only">"System"</span>
                    </button>
                }
            }}
        </div>
    }
}
