use leptos::*;
use crate::types::reader::Book;
use crate::components::ui::{
    Dialog, DialogHeader, DialogTitle, DialogDescription, DialogClose, DialogFooter,
    Drawer, DrawerHandle, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter,
    DrawerClose as DrawerCloseComponent, Button, ButtonVariant, ButtonSize
};
use crate::components::icons::{ImageOff, Trash2, Loader2, Share2};
use crate::hooks::use_media_query;

#[component]
pub fn BookDetailDialog(
    book: Option<Book>,
    open: ReadSignal<bool>,
    on_close: Callback<()>,
    on_open_book: Option<Callback<String>>,
    on_delete_book: Option<Callback<String>>,
    #[prop(optional)] is_deleting: Option<ReadSignal<bool>>,
    on_export_epub: Option<Callback<String>>,
) -> impl IntoView {
    let is_desktop = use_media_query("(min-width: 640px)");
    let (confirm_open, set_confirm_open) = create_signal(false);
    let is_deleting_signal = is_deleting.unwrap_or_else(|| {
        let (signal, _) = create_signal(false);
        signal
    });
    
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
            let book_id = book_clone.id.clone();
            let book_title = book_clone.title.clone();
            
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
                let is_deleting_dialog = is_deleting_signal.clone();
                
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
                                    <div class="flex flex-col gap-1 text-left">
                                        <DialogTitle>{book_title_for_dialog}</DialogTitle>
                                        <DialogDescription>"Book overview and metadata"</DialogDescription>
                                    </div>
                                    <DialogClose on_click=Callback::new(move |_| on_close_dialog.call(())) />
                                </div>
                            </DialogHeader>
                            <div class="flex flex-col gap-4">
                                {book_detail_content(book_for_dialog.clone(), on_open_book_dialog, on_delete_book_dialog, is_deleting_dialog, set_confirm_open_dialog, on_export_epub_dialog, false)}
                            </div>
                            <DialogFooter>
                                {book_detail_actions(book_for_dialog.id.clone(), on_open_book_dialog, on_delete_book_dialog, is_deleting_dialog, set_confirm_open_dialog, on_export_epub_dialog, true)}
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
                let is_deleting_drawer = is_deleting_signal.clone();
                
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
                                    {book_detail_content(book_for_drawer.clone(), on_open_book_drawer, on_delete_book_drawer, is_deleting_drawer, set_confirm_open_drawer, on_export_epub_drawer, false)}
                                </div>
                                <DrawerFooter class="px-1">
                                    {book_detail_actions(book_for_drawer.id.clone(), on_open_book_drawer, on_delete_book_drawer, is_deleting_drawer, set_confirm_open_drawer, on_export_epub_drawer, false)}
                                </DrawerFooter>
                            </div>
                        </Drawer>
                        {confirm_dialog(book_title.clone(), book_id_for_drawer, confirm_open_drawer, set_confirm_open_drawer, on_delete_book_drawer, is_deleting_drawer)}
                    </>
                }.into_view()
            }
        }}
    }
}

fn book_detail_content(
    book: Book,
    on_open_book: Option<Callback<String>>,
    on_delete_book: Option<Callback<String>>,
    is_deleting: ReadSignal<bool>,
    set_confirm_open: WriteSignal<bool>,
    on_export_epub: Option<Callback<String>>,
    _is_dialog: bool,
) -> impl IntoView {
    view! {
        <div class="flex flex-col gap-4">
            // Cover image
            <div class="flex flex-col gap-2">
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
                            <div class="flex h-full w-full items-center justify-center">
                                <ImageOff size=40 class="h-10 w-10 text-muted-foreground/50" />
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
            
            // Book info
            <div class="flex flex-col gap-2">
                <div>
                    <h3 class="text-lg font-semibold">{book.title.clone()}</h3>
                    <p class="text-sm text-muted-foreground">{book.author.clone()}</p>
                </div>
                
                {if let Some(subjects) = book.subjects.clone() {
                    if !subjects.is_empty() {
                        let subjects_text = subjects.join(", ");
                        view! {
                            <p class="text-sm text-muted-foreground">{subjects_text}</p>
                        }.into_view()
                    } else {
                        view! {}.into_view()
                    }
                } else {
                    view! {}.into_view()
                }}
                
                <div class="flex flex-col gap-1 text-sm">
                    {if !book.chapters.is_empty() {
                        view! {
                            <p class="text-muted-foreground">
                                {format!("Chapters: {}", book.chapters.len())}
                            </p>
                        }.into_view()
                    } else {
                        view! {}.into_view()
                    }}
                    
                    {if !book.audio_tracks.is_empty() {
                        view! {
                            <p class="text-muted-foreground">
                                {format!("Audio tracks: {}", book.audio_tracks.len())}
                            </p>
                        }.into_view()
                    } else {
                        view! {}.into_view()
                    }}
                </div>
            </div>
            
        </div>
    }
}

fn book_detail_actions(
    book_id: String,
    on_open_book: Option<Callback<String>>,
    on_delete_book: Option<Callback<String>>,
    is_deleting: ReadSignal<bool>,
    set_confirm_open: WriteSignal<bool>,
    on_export_epub: Option<Callback<String>>,
    is_dialog: bool,
) -> impl IntoView {
    view! {
        <div class=move || {
            if is_dialog {
                "flex gap-2 justify-end pt-4"
            } else {
                "flex flex-col gap-2"
            }
        }>
            {if let Some(on_export) = on_export_epub {
                let book_id_export = book_id.clone();
                view! {
                    <Button
                        variant=ButtonVariant::Outline
                        on_click=Callback::new(move |_| {
                            on_export.call(book_id_export.clone());
                        })
                        disabled=is_deleting.clone()
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
                        disabled=is_deleting.clone()
                        class="flex-1"
                    >
                        {move || "Open Book"}
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
                        disabled=is_deleting.clone()
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
                        disabled=is_deleting.clone()
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
                                disabled=is_deleting.clone()
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
