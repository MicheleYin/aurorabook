use leptos::*;
use crate::components::ui::{Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button, ButtonVariant, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem};
use crate::constants::{get_kokoro_voice_groups, KokoroVoiceGroup};
use crate::types::reader::VoiceId;
use crate::hooks::settings::use_persistent_settings;

#[component]
pub fn ConvertToAudiobookDialog(
    open: ReadSignal<bool>,
    on_open_change: Callback<bool>,
    on_confirm: Callback<VoiceId>,
    book_title: String,
) -> impl IntoView {
    let (settings, _, _) = use_persistent_settings();
    let (selected_voice, set_selected_voice) = create_signal(settings.get().tts_voice_id.clone());
    
    // Update selected voice when dialog opens or settings change
    create_effect(move |_| {
        if open.get() {
            set_selected_voice.set(settings.get().tts_voice_id.clone());
        }
    });
    
    let handle_confirm = Callback::new({
        let selected_voice_signal = selected_voice.clone();
        let on_confirm_clone = on_confirm.clone();
        let on_open_change_clone = on_open_change.clone();
        move |_| {
            on_confirm_clone.call(selected_voice_signal.get());
            on_open_change_clone.call(false);
        }
    });
    
    let handle_cancel = Callback::new({
        let on_open_change_clone = on_open_change.clone();
        move |_| {
            on_open_change_clone.call(false);
        }
    });
    
    view! {
        <Dialog
            open=open
            on_open_change=on_open_change
            class="sm:max-w-[500px]"
            z_index="z-[100]"
        >
            <DialogHeader>
                <DialogTitle>"Convert to Audiobook?"</DialogTitle>
                <DialogDescription>
                    "This ebook doesn't have audio tracks. Would you like to convert it to an audiobook using text-to-speech? This may take some time depending on the book length."
                </DialogDescription>
            </DialogHeader>
            <div class="py-4">
                <div class="space-y-2">
                    <label class="text-sm font-medium">{format!("Book: {}", book_title)}</label>
                    <div class="space-y-2">
                        <label class="text-sm font-medium">
                            "Select Voice:"
                        </label>
                        <div class="relative">
                            <Select
                                value=selected_voice.get()
                                on_value_change=Callback::new(move |value: String| {
                                    set_selected_voice.set(value);
                                })
                            >
                                <SelectTrigger class="w-full">
                                    <SelectValue placeholder="Select a voice" />
                                </SelectTrigger>
                            <SelectContent>
                                {{
                                    let groups = get_kokoro_voice_groups();
                                    groups.into_iter().map(|group: KokoroVoiceGroup| {
                                        let group_label = group.label.clone();
                                        let voices = group.voices.clone();
                                        view! {
                                            <SelectGroup>
                                                <SelectLabel>{group_label}</SelectLabel>
                                                {voices.into_iter().map(|voice| {
                                                    let voice_id = voice.id.clone();
                                                    let voice_name = voice.name.clone();
                                                    view! {
                                                        <SelectItem value=voice_id.clone()>
                                                            {voice_name}
                                                        </SelectItem>
                                                    }.into_view()
                                                }).collect::<Vec<_>>()}
                                            </SelectGroup>
                                        }.into_view()
                                    }).collect::<Vec<_>>()
                                }}
                            </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button
                    variant=ButtonVariant::Outline
                    on_click=handle_cancel
                >
                    {move || "Cancel"}
                </Button>
                <Button
                    variant=ButtonVariant::Default
                    on_click=handle_confirm
                >
                    {move || "Convert to Audiobook"}
                </Button>
            </DialogFooter>
        </Dialog>
    }
}


