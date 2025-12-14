use leptos::*;

#[component]
pub fn LibraryPanel() -> impl IntoView {
    view! {
        <div class="flex flex-col h-full">
            <div class="flex-1 overflow-auto">
                <div class="p-6">
                    <h2 class="text-2xl font-bold mb-4">Library</h2>
                    <p class="text-muted-foreground">
                        "Library panel - content will be migrated here"
                    </p>
                </div>
            </div>
        </div>
    }
}
