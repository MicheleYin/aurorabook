use leptos::*;
use crate::types::reader::Book;
use crate::components::ui::{Drawer, DrawerHandle, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose as DrawerCloseComponent, Button, ButtonVariant, ScrollArea};
use crate::components::icons::X;

#[component]
pub fn ReaderTocDrawer(
    book: Book,
    active_chapter_id: Option<String>,
    is_open: ReadSignal<bool>,
    on_open_change: Callback<bool>,
    on_select_chapter: Callback<String>,
) -> impl IntoView {
    let trigger_button = view! {
        <Button
variant=ButtonVariant::Outline
                size=crate::components::ui::ButtonSize::Sm
                on_click=Callback::new(move |_| on_open_change.call(true))
            class="gap-2"
        >
            <crate::components::icons::BookOpen size=16 class="shrink-0 sm:mr-2" />
            <span class="hidden sm:inline-block whitespace-nowrap">"Table of contents"</span>
        </Button>
    };
    
    view! {
        <>
            {trigger_button}
            <Drawer
                open=is_open
                on_open_change=on_open_change
                class="fixed inset-y-0 left-0 right-auto top-0 bottom-0 h-full max-h-none w-full max-w-[320px] rounded-none border-r p-0 shadow-2xl sm:max-w-[360px] sm:rounded-none sm:border-r sm:shadow-2xl data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
            >
                <div class="flex h-full flex-1 flex-col overflow-hidden p-6 min-w-0">
                    <DrawerHeader class="flex flex-row items-start justify-between text-left min-w-0">
                        <div class="min-w-0 flex-1">
                            <DrawerTitle class="text-lg font-semibold">"Table of contents"</DrawerTitle>
                            <DrawerDescription>
                                "Jump between chapters without leaving the reader."
                            </DrawerDescription>
                        </div>
                        <DrawerCloseComponent on_click=Callback::new(move |_| on_open_change.call(false)) />
                    </DrawerHeader>
                    <ScrollArea class="mt-4 flex-1 pr-2 min-w-0 w-full">
                        <div class="w-full min-w-0">
                            {move || {
                                let active_id = active_chapter_id.clone();
                                book.chapters.iter().map(move |chapter| {
                                    let chapter_id = chapter.id.clone();
                                    let chapter_title = chapter.title.clone();
                                    let is_active = active_id.as_ref().map(|id| id == &chapter_id).unwrap_or(false);
                                    let on_select = on_select_chapter.clone();
                                    let on_close = on_open_change.clone();
                                    let variant_val = if is_active {
                                        ButtonVariant::Secondary
                                    } else {
                                        ButtonVariant::Ghost
                                    };
                                    view! {
                                    <Button
                                        variant=variant_val
                                        on_click=Callback::new(move |_| {
                                            on_select.call(chapter_id.clone());
                                            on_close.call(false);
                                        })
                                        class="justify-start relative min-w-0 w-full max-w-full overflow-hidden hover:translate-x-1 hover:bg-accent/80 active:translate-x-0.5 transition-all duration-200 ease-out"
                                    >
                                            <div class="flex flex-col flex-1 min-w-0 pr-2 overflow-hidden">
                                                <span class="truncate text-left min-w-0">{chapter_title}</span>
                                            </div>
                                        </Button>
                                    }.into_view()
                                }).collect::<Vec<_>>()
                            }}
                        </div>
                    </ScrollArea>
                </div>
            </Drawer>
        </>
    }
}


