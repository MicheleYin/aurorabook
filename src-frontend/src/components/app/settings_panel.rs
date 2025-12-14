use leptos::*;
use crate::components::ui::*;
use crate::components::app::{ThemeSwitcher, LoadingScreen};
use crate::components::icons::{Volume2, Play, Pause, HelpCircle, ChevronDown, Check};
use crate::types::settings::{UITheme, AppSettings};
use crate::constants::{get_kokoro_voice_groups, KokoroVoiceOption};
use crate::services::resources_service::read_resource_file;
use gloo_timers::callback::Timeout;
use wasm_bindgen::{JsCast, closure::Closure, JsValue};
use web_sys::{HtmlAudioElement, Blob, Url};

#[derive(Debug, Clone)]
struct FAQItem {
    question: String,
    answer: String,
}

fn get_faq_data() -> Vec<FAQItem> {
    vec![
        FAQItem {
            question: "How does it work?".to_string(),
            answer: "The application uses local TTS (Text-to-Speech) models, specifically Kokoro, combined with Espeak or Phonetisaurus. These tools provide grapheme-to-phoneme conversion (converting written text to phonetic sounds) and phoneme-to-audio conversion (turning phonetic sounds into spoken audio). Everything runs entirely on your device—no cloud services required.".to_string(),
        },
        FAQItem {
            question: "Is my data safe?".to_string(),
            answer: "Yes, your data is completely safe. All processing happens locally on your device. No internet connection is required, and your books, audio files, and personal information never leave your computer. Your privacy is fully protected.".to_string(),
        },
        FAQItem {
            question: "Why is it so slow?".to_string(),
            answer: "Text-to-speech conversion is computationally demanding. The process involves complex neural network models that generate high-quality audio, which requires significant processing power. The speed depends on your device's CPU capabilities and the length of the content being converted. There are plans to improve the speed in the future".to_string(),
        },
        FAQItem {
            question: "Can I listen to chapters immediately?".to_string(),
            answer: "Yes! You can listen to a chapter as soon as that specific chapter finishes converting. You don't need to wait for the entire book to be completed. This allows you to start enjoying your audiobook while the rest of the book continues processing in the background.".to_string(),
        },
        FAQItem {
            question: "What file formats are supported?".to_string(),
            answer: "The application supports EPUB files for conversion to audiobooks. EPUB is a widely-used ebook format that preserves the structure and formatting of books, making it ideal for creating well-organized audiobooks with proper chapter divisions.".to_string(),
        },
        FAQItem {
            question: "Can I customize the voice?".to_string(),
            answer: "Yes! You can choose from multiple voices available in the Kokoro model. Each voice has different characteristics including language, gender, and speaking style. You can preview voices before selecting one, and your choice will be saved as your default preference.".to_string(),
        },
        FAQItem {
            question: "Where are the audio files stored?".to_string(),
            answer: "All generated audio files are stored locally on your device. They are organized alongside your book library and remain accessible even when offline. You can manage and delete these files through the application's library interface.".to_string(),
        },
        FAQItem {
            question: "Can I pause or cancel a conversion?".to_string(),
            answer: "Yes, you can cancel an ongoing conversion at any time. If you cancel, any chapters that have already been completed will remain available for listening. You can resume or restart the conversion later if needed.".to_string(),
        },
    ]
}

#[component]
pub fn SettingsPanel() -> impl IntoView {
    // Get settings from context (shared with App component)
    let settings = use_context::<RwSignal<AppSettings>>()
        .expect("Settings context not found. SettingsPanel must be used within App component.");
    let update_settings = use_context::<Callback<AppSettings>>()
        .expect("UpdateSettings context not found. SettingsPanel must be used within App component.");
    
    // For hydration check, we can create a local signal or just assume settings are loaded
    // Since App handles the loading, we can skip the hydration check here
    let (is_hydrated, _set_is_hydrated) = create_signal(true);
    let (show_saved, set_show_saved) = create_signal(false);
    let (playing_voice_id, set_playing_voice_id) = create_signal(None::<String>);
    let (expanded_faq, set_expanded_faq) = create_signal(None::<usize>);
    
    // Show "Saved" indicator when settings change
    create_effect(move |_| {
        let _ = settings.get(); // Track changes
        set_show_saved.set(true);
        let timeout = Timeout::new(2000, move || {
            set_show_saved.set(false);
        });
        on_cleanup(move || {
            timeout.cancel();
        });
    });
    
    // Create a memo for the current theme to make it reactive
    let current_theme = create_memo(move |_| settings.get().theme);
    
    let handle_theme_change = move |theme: UITheme| {
        let mut new_settings = settings.get();
        new_settings.theme = theme;
        update_settings.call(new_settings);
    };
    
    let handle_voice_change = move |voice_id: String| {
        let mut new_settings = settings.get();
        new_settings.tts_voice_id = voice_id;
        update_settings.call(new_settings);
    };
    
    // Find selected voice
    let selected_voice = create_memo(move |_| {
        let voice_groups = get_kokoro_voice_groups();
        let current_voice_id = settings.get().tts_voice_id;
        voice_groups.iter()
            .flat_map(|group| group.voices.iter())
            .find(|voice| voice.id == current_voice_id)
            .cloned()
    });
    
    // Store audio element and blob URL using Rc<RefCell> for interior mutability
    use std::rc::Rc;
    use std::cell::RefCell;
    
    let audio_element: Rc<RefCell<Option<HtmlAudioElement>>> = Rc::new(RefCell::new(None));
    let (blob_url, set_blob_url) = create_signal(None::<String>);
    
    // Cleanup on unmount
    let audio_cleanup = audio_element.clone();
    let blob_cleanup = blob_url.clone();
    on_cleanup(move || {
        if let Some(audio) = audio_cleanup.borrow().as_ref() {
            audio.pause().ok();
            audio.set_src("");
        }
        if let Some(url) = blob_cleanup.get() {
            Url::revoke_object_url(&url).ok();
        }
    });
    
    // Create callback for play sample
    let audio_ref = audio_element.clone();
    let set_playing = set_playing_voice_id.clone();
    let set_blob = set_blob_url.clone();
    let get_blob = blob_url.clone();
    
    let handle_play_sample = Callback::new(move |(voice_id, sample_url): (String, String)| {
        let is_playing = playing_voice_id.get().as_ref() == Some(&voice_id);
        
        // If clicking the same voice that's playing, pause it
        if is_playing {
            // Clone the audio element reference to avoid holding borrow
            let audio_opt = audio_ref.borrow().clone();
            if let Some(audio) = audio_opt {
                audio.pause().ok();
                audio.set_current_time(0.0);
            }
            set_playing.set(None);
            return;
        }
        
        // Stop any currently playing audio
        let audio_opt = audio_ref.borrow().clone();
        if let Some(audio) = audio_opt {
            audio.pause().ok();
            audio.set_current_time(0.0);
        }
        
        // Clean up previous blob URL
        if let Some(url) = get_blob.get() {
            Url::revoke_object_url(&url).ok();
            set_blob.set(None);
        }
        
        // Load and play new sample
        let voice_id_clone = voice_id.clone();
        let sample_url_clone = sample_url.clone();
        let set_playing_clone = set_playing.clone();
        let audio_ref_clone = audio_ref.clone();
        let set_blob_clone = set_blob.clone();
        
        spawn_local(async move {
            match read_resource_file(&sample_url_clone).await {
                Ok(file_data) => {
                    // Convert Vec<u8> to Uint8Array
                    let uint8_array = js_sys::Uint8Array::from(&file_data[..]);
                    
                    // Detect MIME type from file extension
                    let mime_type = if sample_url_clone.ends_with(".mp3") {
                        "audio/mpeg"
                    } else if sample_url_clone.ends_with(".wav") {
                        "audio/wav"
                    } else if sample_url_clone.ends_with(".m4a") {
                        "audio/mp4"
                    } else if sample_url_clone.ends_with(".ogg") {
                        "audio/ogg"
                    } else if sample_url_clone.ends_with(".opus") {
                        "audio/opus"
                    } else {
                        "audio/mpeg" // Default fallback
                    };
                    
                    // Create blob from array with MIME type using JavaScript Reflect.construct
                    let window = web_sys::window().unwrap();
                    let blob_constructor = js_sys::Reflect::get(&window, &JsValue::from_str("Blob"))
                        .unwrap()
                        .dyn_into::<js_sys::Function>()
                        .unwrap();
                    
                    let blob_parts = js_sys::Array::new();
                    blob_parts.push(&uint8_array);
                    
                    let blob_options = js_sys::Object::new();
                    js_sys::Reflect::set(&blob_options, &JsValue::from_str("type"), &JsValue::from_str(mime_type)).unwrap();
                    
                    let blob_args = js_sys::Array::new();
                    blob_args.push(&blob_parts.into());
                    blob_args.push(&blob_options.into());
                    
                    // Use Reflect.construct to call Blob constructor with 'new'
                    let blob = js_sys::Reflect::construct(&blob_constructor, &blob_args)
                        .unwrap()
                        .dyn_into::<Blob>()
                        .unwrap();
                    
                    // Create blob URL
                    let blob_url_str = Url::create_object_url_with_blob(&blob).unwrap();
                    set_blob_clone.set(Some(blob_url_str.clone()));
                    
                    // Get or create audio element
                    let audio = {
                        // Clone the existing audio element if it exists (drops borrow immediately)
                        let existing_audio = audio_ref_clone.borrow().clone();
                        if let Some(audio_el) = existing_audio {
                            audio_el
                        } else {
                            let new_audio = HtmlAudioElement::new().unwrap();
                            
                            // Set up event listeners
                            {
                                let set_playing_for_ended = set_playing_clone.clone();
                                let ended_closure = Closure::wrap(Box::new(move |_| {
                                    set_playing_for_ended.set(None);
                                }) as Box<dyn FnMut(web_sys::Event)>);
                                new_audio.set_onended(Some(ended_closure.as_ref().unchecked_ref()));
                                ended_closure.forget();
                            }
                            
                            {
                                let set_playing_for_error = set_playing_clone.clone();
                                let sample_url_for_error = sample_url_clone.clone();
                                let error_closure = Closure::wrap(Box::new(move |_| {
                                    web_sys::console::error_1(&format!("Failed to play voice sample: {}", sample_url_for_error).into());
                                    set_playing_for_error.set(None);
                                }) as Box<dyn FnMut(web_sys::Event)>);
                                new_audio.set_onerror(Some(error_closure.as_ref().unchecked_ref()));
                                error_closure.forget();
                            }
                            
                            // Store the audio element (borrow is dropped after this block)
                            *audio_ref_clone.borrow_mut() = Some(new_audio.clone());
                            new_audio
                        }
                    };
                    
                    // Set source and play
                    audio.set_src(&blob_url_str);
                    if let Err(e) = audio.play() {
                        web_sys::console::error_1(&format!("Error playing audio: {:?}", e).into());
                        set_playing_clone.set(None);
                    } else {
                        set_playing_clone.set(Some(voice_id_clone));
                    }
                }
                Err(e) => {
                    web_sys::console::error_1(&format!("Failed to load voice sample: {}", e).into());
                    set_playing_clone.set(None);
                }
            }
        });
    });
    
    let handle_toggle_faq = move |index: usize| {
        set_expanded_faq.update(|current| {
            *current = if *current == Some(index) { None } else { Some(index) };
        });
    };
    
    view! {
        {move || {
            if !is_hydrated.get() {
                view! {
                    <LoadingScreen message="Loading settings..." />
                }.into_view()
            } else {
                view! {
        <div class="flex h-full flex-col gap-6 safe-area-top">
            <Card class="flex-1">
                <CardHeader class="relative">
                    <CardTitle class="text-xl">"Preferences"</CardTitle>
                    <CardDescription>"Control the Reader theme and voice settings from one place."</CardDescription>
                    // Saved confirmation
                    <div
                        class=move || {
                            let base = "absolute right-4 top-4 flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm text-primary transition-all duration-300 ease-in-out";
                            if show_saved.get() {
                                format!("{} opacity-100 translate-y-0 scale-100", base)
                            } else {
                                format!("{} opacity-0 translate-y-2 scale-95 pointer-events-none", base)
                            }
                        }
                    >
                        <Check size=16 />
                        <span>"Saved"</span>
                    </div>
                </CardHeader>
                <CardContent>
                    <div class="space-y-6">
                        // Theme Section
                        <div class="w-full flex flex-col gap-4 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p class="font-medium">"Theme"</p>
                                <p class="text-sm text-muted-foreground">
                                    "Switch between light, dark, or follow your system setting."
                                </p>
                            </div>
                            <div class="flex w-full justify-center sm:w-auto sm:justify-end">
                                <ThemeSwitcher
                                    value=current_theme
                                    on_change=Callback::new(move |theme| handle_theme_change(theme))
                                />
                            </div>
                        </div>
                        
                        // Voice Selection Section
                        <div class="flex flex-col gap-2 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                            <div class="flex-1">
                                <p class="font-medium">"Default voice"</p>
                                <p class="text-sm text-muted-foreground">
                                    "Select the voice used for previews and on-device narration."
                                </p>
                            </div>
                            <div class="sm:max-w-xs w-full relative">
                                {move || {
                                    let current_voice_id = settings.get().tts_voice_id.clone();
                                    view! {
                                        <Select
                                            value=current_voice_id
                                            on_value_change=Callback::new(move |voice_id| handle_voice_change(voice_id))
                                        >
                                    <SelectTrigger class="w-full">
                                        <SelectValue placeholder="Choose a voice" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {move || {
                                            get_kokoro_voice_groups().into_iter().map(|group| {
                                                view! {
                                                    <SelectGroup>
                                                        <SelectLabel>{group.label.clone()}</SelectLabel>
                                                        {group.voices.into_iter().map(move |voice| {
                                                            let voice_id = voice.id.clone();
                                                            let voice_name = voice.name.clone();
                                                            view! {
                                                                <SelectItem value=voice_id.clone()>
                                                                    {voice_name}
                                                                </SelectItem>
                                                            }
                                                        }).collect::<Vec<_>>()}
                                                    </SelectGroup>
                                                }
                                            }).collect::<Vec<_>>()
                                        }}
                                    </SelectContent>
                                </Select>
                                    }
                                }}
                            </div>
                        </div>
                        
                        // Voice Preview
                        {move || {
                            selected_voice.get().map(|voice| {
                                let voice_id_clone = voice.id.clone();
                                let sample_url_clone = voice.sample_url.clone();
                                let voice_id_for_check = voice.id.clone();
                                
                                view! {
                                    <div class="rounded-lg border bg-gradient-to-br from-muted/50 to-muted/30 p-4 transition-all duration-300">
                                        <div class="flex items-start gap-4">
                                            <div class="flex-1 min-w-0">
                                                <div class="flex items-center gap-2 mb-2">
                                                    <Volume2 size=16 class="text-muted-foreground" />
                                                    <h4 class="font-semibold text-sm">"Voice Preview"</h4>
                                                </div>
                                                <div class="space-y-1">
                                                    <p class="font-medium text-base">{voice.name.clone()}</p>
                                                    <div class="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <span class="px-2 py-0.5 rounded-full bg-background/60 border border-border/40">
                                                            {voice.language_tag.clone().to_uppercase()}
                                                        </span>
                                                        <span class="px-2 py-0.5 rounded-full bg-background/60 border border-border/40">
                                                            {voice.gender.clone()}
                                                        </span>
                                                        <span class="text-muted-foreground/80">
                                                            {voice.summary.clone()}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <Button
                                                variant=ButtonVariant::Secondary
                                                size=ButtonSize::Lg
                                                on_click=Callback::new(move |_| {
                                                    handle_play_sample.call((voice_id_clone.clone(), sample_url_clone.clone()));
                                                })
                                                class="shrink-0 gap-2 min-w-[140px] justify-center"
                                            >
                                                {move || {
                                                    if playing_voice_id.get().as_ref() == Some(&voice_id_for_check) {
                                                        view! {
                                                            <>
                                                                <Pause size=16 />
                                                                <span>"Pause"</span>
                                                            </>
                                                        }.into_view()
                                                    } else {
                                                        view! {
                                                            <>
                                                                <Play size=16 />
                                                                <span>"Play"</span>
                                                            </>
                                                        }.into_view()
                                                    }
                                                }}
                                            </Button>
                                        </div>
                                    </div>
                                }
                            })
                        }}
                    </div>
                </CardContent>
            </Card>
            
            // FAQ Section
            <Card>
                <CardHeader>
                    <div class="flex items-center gap-2">
                        <HelpCircle size=20 class="text-muted-foreground" />
                        <CardTitle class="text-xl">"Frequently Asked Questions"</CardTitle>
                    </div>
                    <CardDescription>"Find answers to common questions about the application."</CardDescription>
                </CardHeader>
                <CardContent>
                    <div class="space-y-2">
                        {get_faq_data().into_iter().enumerate().map(move |(index, faq)| {
                            let index_clone = index;
                            let expanded_faq_signal = expanded_faq.clone();
                            
                            view! {
                                <div class="rounded-lg border bg-card transition-all duration-200 hover:bg-muted/30">
                                    <button
                                        type="button"
                                        on:click=move |_| handle_toggle_faq(index_clone)
                                        class="w-full flex items-center justify-between p-4 text-left gap-4 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-lg"
                                        aria-expanded=move || expanded_faq_signal.get() == Some(index)
                                    >
                                        <span class="font-semibold text-sm sm:text-base pr-4">{faq.question.clone()}</span>
                                        <div class="shrink-0">
                                            {move || {
                                                if expanded_faq_signal.get() == Some(index) {
                                                    view! {
                                                        <ChevronDown size=20 class="text-muted-foreground transition-transform rotate-180" />
                                                    }.into_view()
                                                } else {
                                                    view! {
                                                        <ChevronDown size=20 class="text-muted-foreground transition-transform" />
                                                    }.into_view()
                                                }
                                            }}
                                        </div>
                                    </button>
                                    {move || {
                                        if expanded_faq_signal.get() == Some(index) {
                                            view! {
                                                <div class="px-4 pb-4 text-sm text-muted-foreground leading-relaxed animate-in slide-in-from-top-1 fade-in-0 duration-200">
                                                    <p class="whitespace-pre-line">{faq.answer.clone()}</p>
                                                </div>
                                            }.into_view()
                                        } else {
                                            view! { <></> }.into_view()
                                        }
                                    }}
                                </div>
                            }
                        }).collect::<Vec<_>>()}
                    </div>
                </CardContent>
            </Card>
            <div class="pb-10"></div>
        </div>
                }.into_view()
            }
        }}
    }
}
