use leptos::*;
use crate::components::ui::Input;
use crate::components::icons::{Search, X};

#[component]
pub fn LibrarySearchBar(
    value: String,
    #[prop(optional)] placeholder: Option<&'static str>,
    on_change: Callback<String>,
    #[prop(optional)] disabled: Option<bool>,
) -> impl IntoView {
    let placeholder_text = placeholder.unwrap_or("Search by title or author");
    let disabled = disabled.unwrap_or(false);
    let has_value = !value.is_empty();

    view! {
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="relative w-full sm:max-w-md">
                <Search
                    size=16
                    class="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
                />
                <input
                    type="search"
                    class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pl-10 pr-10 rounded-lg bg-card focus:border-primary focus:ring-primary/40 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                    prop:value=value.clone()
                    on:input=move |ev| {
                        let val = event_target_value(&ev);
                        on_change.call(val);
                    }
                    disabled=disabled
                    placeholder=placeholder_text
                    aria-label="Search library by title or author"
                />
                {move || {
                    if has_value {
                        view! {
                            <button
                                type="button"
                                on:click=move |_| on_change.call("".to_string())
                                class="absolute right-2 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
                                aria-label="Clear search"
                            >
                                <X size=16 />
                            </button>
                        }.into_view()
                    } else {
                        view! {}.into_view()
                    }
                }}
            </div>
        </div>
    }
}
