use leptos::*;

#[component]
pub fn LoadingScreen(#[prop(optional)] message: Option<&'static str>) -> impl IntoView {
    let message = message.unwrap_or("Loading...");
    
    view! {
        <div class="flex min-h-screen items-center justify-center">
            <div class="flex flex-col items-center gap-4">
                <div class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p class="text-muted-foreground">{message}</p>
            </div>
        </div>
    }
}
