use leptos::*;
use crate::types::reader::ReaderPreferences;
use crate::components::ui::{Drawer, DrawerHandle, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose as DrawerCloseComponent, Button, ButtonVariant};
use crate::components::icons::{Settings2, X};
use crate::components::reader::constants::*;

#[component]
pub fn ReaderSettingsDrawer(
    preferences: ReaderPreferences,
    on_preferences_change: Callback<ReaderPreferences>,
    is_open: ReadSignal<bool>,
    on_open_change: Callback<bool>,
) -> impl IntoView {
    let (local_prefs, set_local_prefs) = create_signal(preferences.clone());
    
    // Update local prefs when prop changes
    let prefs_clone = preferences.clone();
    create_effect(move |_| {
        set_local_prefs.set(prefs_clone.clone());
    });
    
    let handle_font_change = Callback::new({
        let set_prefs = set_local_prefs.clone();
        move |font: crate::types::reader::ReaderFont| {
            set_prefs.update(|p| {
                p.font_family = font;
            });
        }
    });
    
    let handle_font_size_change = Callback::new({
        let set_prefs = set_local_prefs.clone();
        move |size: crate::types::reader::ReaderFontSize| {
            set_prefs.update(|p| {
                p.font_size = size;
            });
        }
    });
    
    let handle_padding_change = Callback::new({
        let set_prefs = set_local_prefs.clone();
        move |padding: crate::types::reader::ReaderContentPadding| {
            set_prefs.update(|p| {
                p.content_padding = padding;
            });
        }
    });
    
    let handle_theme_change = Callback::new({
        let set_prefs = set_local_prefs.clone();
        move |theme: crate::types::reader::ReaderTheme| {
            set_prefs.update(|p| {
                p.theme = theme;
            });
        }
    });
    
    // Apply changes when drawer closes
    create_effect(move |_| {
        if !is_open.get() {
            on_preferences_change.call(local_prefs.get());
        }
    });
    
    view! {
        <Drawer
            open=is_open
            on_open_change=on_open_change
        >
            <DrawerHandle />
            <div class="flex h-full flex-1 flex-col overflow-hidden p-6 min-w-0">
                <DrawerHeader class="flex flex-row items-start justify-between text-left min-w-0">
                    <div class="min-w-0 flex-1">
                        <DrawerTitle class="text-lg font-semibold">"Reader Settings"</DrawerTitle>
                        <DrawerDescription>
                            "Customize your reading experience."
                        </DrawerDescription>
                    </div>
                    <DrawerCloseComponent on_click=Callback::new(move |_| on_open_change.call(false)) />
                </DrawerHeader>
                <div class="mt-4 flex-1 overflow-auto pr-2">
                    <div class="space-y-6">
                        // Font Family
                        <div class="space-y-2">
                            <label class="text-sm font-medium">"Font Family"</label>
                            <div class="flex flex-wrap gap-2">
                                {move || {
                                    font_options().into_iter().map(move |option| {
                                        let option_id = option.id.clone();
                                        let is_selected = local_prefs.get().font_family == option_id;
                                        let handle_click = handle_font_change.clone();
                                        let variant_val = if is_selected {
                                            ButtonVariant::Secondary
                                        } else {
                                            ButtonVariant::Outline
                                        };
                                        view! {
                                            <Button
                                                variant=variant_val
                                                on_click=Callback::new(move |_| {
                                                    handle_click.call(option_id.clone());
                                                })
                                            >
                                                {option.label}
                                            </Button>
                                        }.into_view()
                                    }).collect::<Vec<_>>()
                                }}
                            </div>
                        </div>
                        
                        // Font Size
                        <div class="space-y-2">
                            <label class="text-sm font-medium">"Font Size"</label>
                            <div class="flex flex-wrap gap-2">
                                {move || {
                                    font_size_options().into_iter().map(move |option| {
                                        let option_id = option.id.clone();
                                        let is_selected = local_prefs.get().font_size == option_id;
                                        let handle_click = handle_font_size_change.clone();
                                        let variant_val = if is_selected {
                                            ButtonVariant::Secondary
                                        } else {
                                            ButtonVariant::Outline
                                        };
                                        view! {
                                            <Button
                                                variant=variant_val
                                                on_click=Callback::new(move |_| {
                                                    handle_click.call(option_id.clone());
                                                })
                                            >
                                                {option.label}
                                            </Button>
                                        }.into_view()
                                    }).collect::<Vec<_>>()
                                }}
                            </div>
                        </div>
                        
                        // Content Padding
                        <div class="space-y-2">
                            <label class="text-sm font-medium">"Content Padding"</label>
                            <div class="flex flex-wrap gap-2">
                                {move || {
                                    content_padding_options().into_iter().map(move |option| {
                                        let option_id = option.id.clone();
                                        let is_selected = local_prefs.get().content_padding == option_id;
                                        let handle_click = handle_padding_change.clone();
                                        let variant_val = if is_selected {
                                            ButtonVariant::Secondary
                                        } else {
                                            ButtonVariant::Outline
                                        };
                                        view! {
                                            <Button
                                                variant=variant_val
                                                on_click=Callback::new(move |_| {
                                                    handle_click.call(option_id.clone());
                                                })
                                            >
                                                {option.label}
                                            </Button>
                                        }.into_view()
                                    }).collect::<Vec<_>>()
                                }}
                            </div>
                        </div>
                        
                        // Theme
                        <div class="space-y-2">
                            <label class="text-sm font-medium">"Theme"</label>
                            <div class="flex flex-wrap gap-2">
                                {move || {
                                    theme_options().into_iter().map(move |option| {
                                        let option_id = option.id.clone();
                                        let is_selected = local_prefs.get().theme == option_id;
                                        let handle_click = handle_theme_change.clone();
                                        let variant_val = if is_selected {
                                            ButtonVariant::Secondary
                                        } else {
                                            ButtonVariant::Outline
                                        };
                                        view! {
                                            <Button
                                                variant=variant_val
                                                on_click=Callback::new(move |_| {
                                                    handle_click.call(option_id.clone());
                                                })
                                            >
                                                {option.label}
                                            </Button>
                                        }.into_view()
                                    }).collect::<Vec<_>>()
                                }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Drawer>
    }
}


