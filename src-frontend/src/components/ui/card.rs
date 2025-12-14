use leptos::*;
use crate::components::ui::utils::cn;

#[component]
pub fn Card(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let classes = cn(&[
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        class.unwrap_or(""),
    ]);
    
    view! {
        <div class=classes>
            {children()}
        </div>
    }
}

#[component]
pub fn CardHeader(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let classes = cn(&["flex flex-col space-y-1.5 p-6", class.unwrap_or("")]);
    
    view! {
        <div class=classes>
            {children()}
        </div>
    }
}

#[component]
pub fn CardTitle(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let classes = cn(&["text-2xl font-semibold leading-none tracking-tight", class.unwrap_or("")]);
    
    view! {
        <h3 class=classes>
            {children()}
        </h3>
    }
}

#[component]
pub fn CardDescription(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let classes = cn(&["text-sm text-muted-foreground", class.unwrap_or("")]);
    
    view! {
        <p class=classes>
            {children()}
        </p>
    }
}

#[component]
pub fn CardContent(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let classes = cn(&["p-6 pt-0", class.unwrap_or("")]);
    
    view! {
        <div class=classes>
            {children()}
        </div>
    }
}

#[component]
pub fn CardFooter(
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let classes = cn(&["flex items-center p-6 pt-0", class.unwrap_or("")]);
    
    view! {
        <div class=classes>
            {children()}
        </div>
    }
}
