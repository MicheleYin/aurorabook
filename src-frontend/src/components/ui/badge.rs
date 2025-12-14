use leptos::*;
use crate::components::ui::utils::cn;

#[derive(Clone, Copy, PartialEq)]
pub enum BadgeVariant {
    Default,
    Secondary,
    Destructive,
    Outline,
}

fn badge_variant_classes(variant: BadgeVariant) -> &'static str {
    match variant {
        BadgeVariant::Default => "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        BadgeVariant::Secondary => "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        BadgeVariant::Destructive => "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        BadgeVariant::Outline => "text-foreground",
    }
}

#[component]
pub fn Badge(
    #[prop(optional)] variant: Option<BadgeVariant>,
    #[prop(optional)] class: Option<&'static str>,
    children: Children,
) -> impl IntoView {
    let variant = variant.unwrap_or(BadgeVariant::Default);
    
    let base_classes = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
    let variant_classes = badge_variant_classes(variant);
    
    let classes = cn(&[base_classes, variant_classes, class.unwrap_or("")]);
    
    view! {
        <div class=classes>
            {children()}
        </div>
    }
}
