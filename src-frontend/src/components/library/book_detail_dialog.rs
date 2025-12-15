use leptos::*;
use crate::types::reader::Book;
use crate::components::ui::{
    Dialog, DialogHeader, DialogTitle, DialogDescription, DialogClose, DialogFooter,
    Drawer, DrawerHandle, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter,
    DrawerClose as DrawerCloseComponent, Button, ButtonVariant, ButtonSize
};
use crate::components::icons::{ImageOff, Trash2, Loader2, Share2, Headphones, Play, Square};
use crate::hooks::use_media_query;
use crate::hooks::use_conversion::use_conversion;
use crate::components::library::utils::get_book_progress_summary;
use crate::components::library::ConvertToAudiobookDialog;
use crate::components::ui::Progress;
use crate::types::{conversion::ConversionProgress, reader::VoiceId};

#[component]
pub fn BookDetailDialog(
    book: Option<Book>,
    open: ReadSignal<bool>,
    on_close: Callback<()>,
    on_open_book: Option<Callback<String>>,
    on_delete_book: Option<Callback<String>>,
    #[prop(optional)] is_deleting: Option<ReadSignal<bool>>,
    on_export_epub: Option<Callback<String>>,
    on_convert_to_audiobook: Option<Callback<(Book, VoiceId)>>,
    on_cancel_conversion: Option<Callback<String>>,
) -> impl IntoView {
    let is_desktop = use_media_query("(min-width: 640px)");
    let (confirm_open, set_confirm_open) = create_signal(false);
    let (show_convert_dialog, set_show_convert_dialog) = create_signal(false);
    let is_deleting_signal = is_deleting.unwrap_or_else(|| {
        let (signal, _) = create_signal(false);
        signal
    });
    let conversion = use_conversion();
    
    view! {
        {move || {
            if !open.get() || book.is_none() {
                return view! {}.into_view();
            }
            
            let book_opt = book.clone();
            let book_clone = book_opt.unwrap();
            let on_close_clone = on_close.clone();
            let on_open_book_clone = on_open_book.clone();
            let on_delete_book_clone = on_delete_book.clone();
            let on_export_epub_clone = on_export_epub.clone();
            let on_convert_clone = on_convert_to_audiobook.clone();
            let on_cancel_clone = on_cancel_conversion.clone();
            let book_id = book_clone.id.clone();
            let book_title = book_clone.title.clone();
            let conversion_clone = conversion.clone();
            
            if is_desktop.get() {
                // Desktop: Dialog
                let on_close_dialog = on_close_clone.clone();
                let on_open_book_dialog = on_open_book_clone.clone();
                let on_delete_book_dialog = on_delete_book_clone.clone();
                let on_export_epub_dialog = on_export_epub_clone.clone();
                let book_for_dialog = book_clone.clone();
                let book_title_for_dialog = book_for_dialog.title.clone();
                let book_id_for_dialog = book_id.clone();
                let confirm_open_dialog = confirm_open.clone();
                let set_confirm_open_dialog = set_confirm_open.clone();
                let show_convert_dialog_dialog = show_convert_dialog.clone();
                let set_show_convert_dialog_dialog = set_show_convert_dialog.clone();
                let is_deleting_dialog = is_deleting_signal.clone();
                let on_convert_dialog = on_convert_clone.clone();
                let on_cancel_dialog = on_cancel_clone.clone();
                let conversion_dialog = conversion_clone.clone();
                
                view! {
                    <>
                        <Dialog
                            open=open
                            on_open_change=Callback::new(move |next: bool| {
                                if !next {
                                    on_close_dialog.call(());
                                }
                            })
                            class="max-w-2xl"
                        >
                            <DialogHeader class="gap-3">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="flex flex-col gap-1 text-left sm:text-left">
                                        <DialogTitle>{book_title_for_dialog}</DialogTitle>
                                        <DialogDescription>"Book overview and metadata"</DialogDescription>
                                    </div>
                                    <DialogClose on_click=Callback::new(move |_| on_close_dialog.call(())) />
                                </div>
                            </DialogHeader>
                            <div class="flex flex-col gap-4">
                                {book_detail_content(book_for_dialog.clone(), on_open_book_dialog, on_delete_book_dialog, is_deleting_dialog, set_confirm_open_dialog, on_export_epub_dialog, conversion_dialog.clone(), false)}
                            </div>
                            <DialogFooter>
                                {book_detail_actions(book_for_dialog.clone(), on_open_book_dialog, on_delete_book_dialog, is_deleting_dialog, set_confirm_open_dialog, on_export_epub_dialog, on_convert_dialog, on_cancel_dialog, set_show_convert_dialog_dialog, conversion_dialog.clone(), true)}
                            </DialogFooter>
                        </Dialog>
                        {confirm_dialog(book_title.clone(), book_id_for_dialog, confirm_open_dialog, set_confirm_open_dialog, on_delete_book_dialog, is_deleting_dialog)}
                    </>
                }.into_view()
            } else {
                // Mobile: Drawer
                let on_close_drawer = on_close_clone.clone();
                let on_open_book_drawer = on_open_book_clone.clone();
                let on_delete_book_drawer = on_delete_book_clone.clone();
                let on_export_epub_drawer = on_export_epub.clone();
                let book_for_drawer = book_clone.clone();
                let book_title_for_drawer = book_for_drawer.title.clone();
                let book_id_for_drawer = book_id.clone();
                let confirm_open_drawer = confirm_open.clone();
                let set_confirm_open_drawer = set_confirm_open.clone();
                let show_convert_dialog_drawer = show_convert_dialog.clone();
                let set_show_convert_dialog_drawer = set_show_convert_dialog.clone();
                let is_deleting_drawer = is_deleting_signal.clone();
                let on_convert_drawer = on_convert_clone.clone();
                let on_cancel_drawer = on_cancel_clone.clone();
                let conversion_drawer = conversion_clone.clone();
                
                view! {
                    <>
                        <Drawer
                            open=open
                            on_open_change=Callback::new(move |next: bool| {
                                if !next {
                                    on_close_drawer.call(());
                                }
                            })
                        >
                            <DrawerHandle />
                            <div class="flex flex-1 flex-col gap-6 overflow-y-auto">
                                <DrawerHeader class="gap-3 text-left">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex flex-col gap-1 text-left">
                                            <DrawerTitle>{book_title_for_drawer}</DrawerTitle>
                                            <DrawerDescription>"Book overview and metadata"</DrawerDescription>
                                        </div>
                                        <DrawerCloseComponent on_click=Callback::new(move |_| on_close_drawer.call(())) />
                                    </div>
                                </DrawerHeader>
                                <div class="px-1">
                                    {book_detail_content(book_for_drawer.clone(), on_open_book_drawer, on_delete_book_drawer, is_deleting_drawer, set_confirm_open_drawer, on_export_epub_drawer, conversion_drawer.clone(), false)}
                                </div>
                                <DrawerFooter class="px-1">
                                    {book_detail_actions(book_for_drawer.clone(), on_open_book_drawer, on_delete_book_drawer, is_deleting_drawer, set_confirm_open_drawer, on_export_epub_drawer, on_convert_drawer, on_cancel_drawer, set_show_convert_dialog_drawer, conversion_drawer.clone(), false)}
                                </DrawerFooter>
                            </div>
                        </Drawer>
                        {confirm_dialog(book_title.clone(), book_id_for_drawer, confirm_open_drawer, set_confirm_open_drawer, on_delete_book_drawer, is_deleting_drawer)}
                        {if let Some(on_convert) = on_convert_clone {
                            let book_for_convert_drawer = book_clone.clone();
                            let book_title_for_convert = book_for_convert_drawer.title.clone();
                            view! {
                                <ConvertToAudiobookDialog
                                    open=show_convert_dialog_drawer
                                    on_open_change=Callback::new(move |open: bool| {
                                        set_show_convert_dialog_drawer.set(open);
                                    })
                                    on_confirm=Callback::new(move |voice_id: VoiceId| {
                                        set_show_convert_dialog_drawer.set(false);
                                        on_convert.call((book_for_convert_drawer.clone(), voice_id));
                                    })
                                    book_title=book_title_for_convert
                                />
                            }.into_view()
                        } else {
                            view! {}.into_view()
                        }}
                    </>
                }.into_view()
            }
        }}
    }
}

fn format_file_size(bytes: Option<u64>) -> String {
    let bytes = match bytes {
        Some(b) => b as f64,
        None => return "Unknown".to_string(),
    };
    
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes;
    let mut unit_index = 0;
    
    while size >= 1024.0 && unit_index < units.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }
    
    if size < 10.0 && unit_index > 0 {
        format!("{:.1} {}", size, units[unit_index])
    } else {
        format!("{:.0} {}", size, units[unit_index])
    }
}

fn format_duration_short(seconds: Option<f64>) -> String {
    let seconds = match seconds {
        Some(s) => s as u64,
        None => return "Unknown".to_string(),
    };
    
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    
    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{}:{:02}", minutes, secs)
    }
}

fn book_detail_content(
    book: Book,
    on_open_book: Option<Callback<String>>,
    on_delete_book: Option<Callback<String>>,
    is_deleting: ReadSignal<bool>,
    set_confirm_open: WriteSignal<bool>,
    on_export_epub: Option<Callback<String>>,
    conversion: crate::hooks::use_conversion::ConversionApi,
    _is_dialog: bool,
) -> impl IntoView {
    let book_id = book.id.clone();
    // Make conversion progress reactive by tracking the signal
    let conversion_progress_signal = conversion.get_progress_signal();
    let conversion_progress = create_memo(move |_| {
        conversion_progress_signal.get().get(&book_id).cloned()
    });
    let progress_summary = get_book_progress_summary(&book);
    let progress_primary_text = if !book.chapters.is_empty() {
        progress_summary.label.clone()
    } else {
        "No chapters available".to_string()
    };
    let progress_secondary_text = if let Some(chapter_title) = &progress_summary.current_chapter_title {
        if progress_summary.current > 0 && !progress_summary.is_finished {
            Some(format!("Current chapter: {}", chapter_title))
        } else if progress_summary.is_finished && !book.chapters.is_empty() {
            Some("You're finished with this book.".to_string())
        } else {
            None
        }
    } else {
        None
    };
    
    let genres: Vec<String> = book.subjects.clone()
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect();
    
    let has_audio = !book.audio_tracks.is_empty();
    
    // Calculate total audio duration
    let total_audio_duration: Option<f64> = if has_audio {
        let sum: f64 = book.audio_tracks.iter()
            .filter_map(|track| track.duration)
            .sum();
        if sum > 0.0 {
            Some(sum)
        } else {
            None
        }
    } else {
        None
    };
    
    // Calculate listened audio duration
    let listened_audio_duration: Option<f64> = if has_audio && book.audio_state.is_some() {
        let audio_state = book.audio_state.as_ref().unwrap();
        let current_index = audio_state.current_track_index;
        let completed: f64 = book.audio_tracks.iter()
            .take(current_index)
            .filter_map(|track| track.duration)
            .sum();
        let current_time = audio_state.current_time_seconds;
        Some(completed + current_time)
    } else {
        None
    };
    
    let audio_progress_percent = if let (Some(total), Some(listened)) = (total_audio_duration, listened_audio_duration) {
        if total > 0.0 {
            Some((listened / total * 100.0).min(100.0).max(0.0))
        } else {
            None
        }
    } else {
        None
    };
    
    view! {
        <div class="grid gap-6 text-sm text-foreground sm:grid-cols-[auto,1fr] sm:items-start">
            // Cover image column
            <div class="grid gap-2">
                <span class="text-xs uppercase text-muted-foreground">"Cover"</span>
                <div class="relative mx-auto aspect-[3/4] w-36 overflow-hidden rounded-lg border bg-muted shadow-sm sm:mx-0 sm:w-40">
                    {if let Some(cover_url) = book.cover_url.clone() {
                        view! {
                            <img
                                src=cover_url
                                alt=format!("{} cover", book.title)
                                class="h-full w-full object-cover"
                            />
                        }.into_view()
                    } else {
                        view! {
                            <div class="flex h-full w-full items-center justify-center text-muted-foreground">
                                <ImageOff size=40 class="h-10 w-10 text-muted-foreground" />
                            </div>
                        }.into_view()
                    }}
                </div>
                {if book.cover_url.is_none() {
                    view! {
                        <span class="text-xs text-muted-foreground">"No cover available"</span>
                    }.into_view()
                } else {
                    view! {}.into_view()
                }}
            </div>
            
            // Details column
            <div class="grid gap-4">
                // Conversion progress
                {move || {
                    let progress_opt = conversion_progress.get();
                    if let Some(progress) = progress_opt {
                        let percent = if progress.total_words > 0 {
                            ((progress.words_processed as f64 / progress.total_words as f64) * 100.0).min(100.0).max(0.0)
                        } else if progress.total_chapters > 0 {
                            ((progress.current_chapter as f64 / progress.total_chapters as f64) * 100.0).min(100.0).max(0.0)
                        } else {
                            0.0
                        };
                        
                        let progress_text = if progress.total_words > 0 {
                            format!("{} / {} words: {}", 
                                progress.words_processed, 
                                progress.total_words, 
                                progress.message)
                        } else {
                            format!("Chapter {} of {}: {}", 
                                progress.current_chapter, 
                                progress.total_chapters, 
                                progress.message)
                        };
                        
                        view! {
                            <div class="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                                <div class="flex items-center justify-between">
                                    <span class="text-xs uppercase text-muted-foreground">"Converting to Audiobook"</span>
                                    <span class="text-xs font-medium">{format!("{:.0}%", percent)}</span>
                                </div>
                                <Progress value=percent max=100.0 />
                                <div class="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 size=12 class="animate-spin" />
                                    <span>{progress_text}</span>
                                </div>
                            </div>
                        }.into_view()
                    } else {
                        view! {}.into_view()
                    }
                }}
                // Reading progress
                <div class="grid gap-1">
                    <span class="text-xs uppercase text-muted-foreground">"Reading progress"</span>
                    <span>{progress_primary_text.clone()}</span>
                    {if let Some(secondary) = &progress_secondary_text {
                        view! {
                            <span class="text-xs text-muted-foreground">{secondary.clone()}</span>
                        }.into_view()
                    } else {
                        view! {}.into_view()
                    }}
                </div>
                
                // Author
                <div class="grid gap-1">
                    <span class="text-xs uppercase text-muted-foreground">"Author"</span>
                    <span>{book.author.clone()}</span>
                </div>
                
                // Publisher
                <div class="grid gap-1">
                    <span class="text-xs uppercase text-muted-foreground">"Publisher"</span>
                    <span>{book.publisher.clone().unwrap_or_else(|| "Unknown publisher".to_string())}</span>
                </div>
                
                // Publication year
                <div class="grid gap-1">
                    <span class="text-xs uppercase text-muted-foreground">"Publication year"</span>
                    <span>{book.published_year.clone().unwrap_or_else(|| "Unknown year".to_string())}</span>
                </div>
                
                // Genres / subjects
                <div class="grid gap-1">
                    <span class="text-xs uppercase text-muted-foreground">"Genres / subjects"</span>
                    {if !genres.is_empty() {
                        view! {
                            <div class="flex flex-wrap gap-2">
                                {genres.into_iter().map(|subject| {
                                    view! {
                                        <span class="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                                            {subject}
                                        </span>
                                    }.into_view()
                                }).collect::<Vec<_>>()}
                            </div>
                        }.into_view()
                    } else {
                        view! {
                            <span>"Not available"</span>
                        }.into_view()
                    }}
                </div>
                
                // File size
                <div class="grid gap-1">
                    <span class="text-xs uppercase text-muted-foreground">"File size"</span>
                    <span>{format_file_size(book.file_size_bytes)}</span>
                </div>
                
                // Audiobook
                <div class="grid gap-1">
                    <span class="text-xs uppercase text-muted-foreground">"Audiobook"</span>
                    {if has_audio {
                        view! {
                            <div class="flex flex-col gap-3">
                                <div class="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3 sm:gap-4">
                                    <div class="flex flex-col gap-1">
                                        <span class="uppercase tracking-wide">"Total tracks"</span>
                                        <span class="text-base text-foreground">{book.audio_tracks.len()}</span>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="uppercase tracking-wide">"Total length"</span>
                                        <span class="text-base text-foreground">
                                            {if let Some(duration) = total_audio_duration {
                                                format_duration_short(Some(duration))
                                            } else {
                                                "Unknown".to_string()
                                            }}
                                        </span>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="uppercase tracking-wide">"Time listened"</span>
                                        <span class="text-base text-foreground">
                                            {if let Some(duration) = listened_audio_duration {
                                                format_duration_short(Some(duration))
                                            } else {
                                                "Not started".to_string()
                                            }}
                                        </span>
                                    </div>
                                </div>
                                {if let Some(percent) = audio_progress_percent {
                                    let percent_rounded = percent.round() as u32;
                                    view! {
                                        <div class="flex flex-col gap-1 text-xs text-muted-foreground">
                                            <span>
                                                {format!("Listened {} · {}%", 
                                                    format_duration_short(listened_audio_duration),
                                                    percent_rounded)}
                                            </span>
                                            // Note: Progress bar component would go here if available
                                        </div>
                                    }.into_view()
                                } else {
                                    view! {}.into_view()
                                }}
                            </div>
                        }.into_view()
                    } else {
                        view! {
                            <span>"Not available"</span>
                        }.into_view()
                    }}
                </div>
            </div>
        </div>
    }
}

fn book_detail_actions(
    book: Book,
    on_open_book: Option<Callback<String>>,
    on_delete_book: Option<Callback<String>>,
    is_deleting: ReadSignal<bool>,
    set_confirm_open: WriteSignal<bool>,
    on_export_epub: Option<Callback<String>>,
    on_convert_to_audiobook: Option<Callback<(Book, VoiceId)>>,
    on_cancel_conversion: Option<Callback<String>>,
    set_show_convert_dialog: WriteSignal<bool>,
    conversion: crate::hooks::use_conversion::ConversionApi,
    is_dialog: bool,
) -> impl IntoView {
    let book_id = book.id.clone();
    let conversion_status = book.conversion_status.as_ref().map(|s| s.as_str()).unwrap_or("notStarted");
    let is_converting = conversion.is_converting(&book_id);
    let is_cancelling = conversion.is_cancelling(&book_id);
    let can_resume = conversion_status == "started" && !is_converting && !is_cancelling;
    let can_convert = conversion_status == "notStarted" && !is_converting && !is_cancelling && book.audio_tracks.is_empty();
    let is_disabled = is_converting || is_cancelling;
    let (is_disabled_signal, set_is_disabled) = create_signal(is_disabled);
    let (is_cancelling_signal, set_is_cancelling) = create_signal(is_cancelling);
    create_effect(move |_| {
        set_is_disabled.set(is_converting || is_cancelling);
        set_is_cancelling.set(is_cancelling);
    });
    view! {
        <div class=move || {
            if is_dialog {
                "flex gap-2 pt-4 justify-end"
            } else {
                "flex flex-col gap-2"
            }
        }>
            {if can_resume {
                if let Some(on_convert) = on_convert_to_audiobook {
                    let book_for_resume = book.clone();
                    let voice_id_for_resume = book.voice_id.clone().unwrap_or_default();
                    view! {
                        <Button
                            variant=ButtonVariant::Outline
                            on_click=Callback::new(move |_| {
                                on_convert.call((book_for_resume.clone(), voice_id_for_resume.clone()));
                            })
                            disabled=is_disabled_signal
                            class="gap-2"
                        >
                            <Play size=16 />
                            "Resume Conversion"
                        </Button>
                    }.into_view()
                } else {
                    view! {}.into_view()
                }
            } else {
                view! {}.into_view()
            }}
            {if can_convert {
                if let Some(_on_convert) = on_convert_to_audiobook {
                    let set_show_dialog = set_show_convert_dialog.clone();
                    view! {
                        <Button
                            variant=ButtonVariant::Outline
                            on_click=Callback::new(move |_| {
                                set_show_dialog.set(true);
                            })
                            disabled=is_disabled_signal
                            class="gap-2"
                        >
                            <Headphones size=16 />
                            "Convert to Audiobook"
                        </Button>
                    }.into_view()
                } else {
                    view! {}.into_view()
                }
            } else {
                view! {}.into_view()
            }}
            {if is_converting {
                if let Some(on_cancel) = on_cancel_conversion {
                    let book_id_cancel = book_id.clone();
                    view! {
                        <Button
                            variant=ButtonVariant::Outline
                            on_click=Callback::new(move |_| {
                                on_cancel.call(book_id_cancel.clone());
                            })
                            disabled=is_cancelling_signal
                            class="gap-2"
                        >
                            {move || {
                                if is_cancelling {
                                    view! {
                                        <Loader2 size=16 class="animate-spin" />
                                        <span>"Pausing…"</span>
                                    }.into_view()
                                } else {
                                    view! {
                                        <Square size=16 />
                                        <span>"Pause"</span>
                                    }.into_view()
                                }
                            }}
                        </Button>
                    }.into_view()
                } else {
                    view! {}.into_view()
                }
            } else {
                view! {}.into_view()
            }}
            {if let Some(on_export) = on_export_epub {
                let book_id_export = book_id.clone();
                view! {
                    <Button
                        variant=ButtonVariant::Outline
                        on_click=Callback::new(move |_| {
                            on_export.call(book_id_export.clone());
                        })
                        disabled=is_deleting
                        class="gap-2"
                    >
                        <Share2 size=16 />
                        {move || "Export EPUB"}
                    </Button>
                }.into_view()
            } else {
                view! {}.into_view()
            }}
            {if let Some(on_open) = on_open_book {
                let book_id_open = book_id.clone();
                view! {
                    <Button
                        variant=ButtonVariant::Default
                        on_click=Callback::new(move |_| {
                            on_open.call(book_id_open.clone());
                        })
                        disabled=is_deleting
                    >
                        {move || "Open book"}
                    </Button>
                }.into_view()
            } else {
                view! {}.into_view()
            }}
            {if let Some(_on_delete) = on_delete_book {
                let _book_id_delete = book_id.clone();
                view! {
                    <Button
                        variant=ButtonVariant::Destructive
                        on_click=Callback::new(move |_| {
                            set_confirm_open.set(true);
                        })
                        disabled=is_deleting
                        class="gap-2"
                    >
                        {move || {
                            if is_deleting.get() {
                                view! {
                                    <Loader2 size=16 class="animate-spin" />
                                    <span>"Deleting…"</span>
                                }.into_view()
                            } else {
                                view! {
                                    <Trash2 size=16 />
                                    <span>"Delete book"</span>
                                }.into_view()
                            }
                        }}
                    </Button>
                }.into_view()
            } else {
                view! {}.into_view()
            }}
        </div>
    }
}

fn confirm_dialog(
    book_title: String,
    book_id: String,
    open: ReadSignal<bool>,
    set_open: WriteSignal<bool>,
    on_delete_book: Option<Callback<String>>,
    is_deleting: ReadSignal<bool>,
) -> impl IntoView {
    view! {
        <Dialog
            open=open
            on_open_change=Callback::new(move |next: bool| {
                set_open.set(next);
            })
            class="max-w-md"
        >
            <DialogHeader>
                <DialogTitle>"Remove audiobook?"</DialogTitle>
                <DialogDescription>
                    {format!("This will remove \"{}\" from your library. You can re-import it at any time.", book_title)}
                </DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <div class="flex justify-end gap-2">
                    <Button
                        variant=ButtonVariant::Outline
                        on_click=Callback::new(move |_| {
                            set_open.set(false);
                        })
                        disabled=is_deleting
                    >
                        {move || "Cancel"}
                    </Button>
                    {if let Some(on_delete) = on_delete_book {
                        let book_id_delete = book_id.clone();
                        let set_open_clone = set_open.clone();
                        view! {
                            <Button
                                variant=ButtonVariant::Destructive
                                on_click=Callback::new(move |_| {
                                    set_open_clone.set(false);
                                    on_delete.call(book_id_delete.clone());
                                })
                                disabled=is_deleting
                            >
                                {move || {
                                    if is_deleting.get() {
                                        view! {
                                            <Loader2 size=16 class="mr-2 animate-spin" />
                                            <span>"Deleting…"</span>
                                        }.into_view()
                                    } else {
                                        view! {
                                            <span>"Delete"</span>
                                        }.into_view()
                                    }
                                }}
                            </Button>
                        }.into_view()
                    } else {
                        view! {}.into_view()
                    }}
                </div>
            </DialogFooter>
        </Dialog>
    }
}
