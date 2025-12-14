use leptos::*;
use crate::components::library::types::LibraryBookStatus;

#[component]
pub fn LibraryStatusBadge(
    status: LibraryBookStatus,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    let (variant, badge_class) = match status {
        LibraryBookStatus::New => (
            crate::components::ui::BadgeVariant::Default,
            "bg-emerald-500 text-white border-transparent",
        ),
        LibraryBookStatus::Resume => (
            crate::components::ui::BadgeVariant::Default,
            "bg-amber-500 text-white border-transparent",
        ),
        LibraryBookStatus::Finished => (
            crate::components::ui::BadgeVariant::Default,
            "bg-blue-500 text-white border-transparent",
        ),
    };

    let label = status.label();
    let combined_class = format!("pointer-events-none text-[10px] uppercase tracking-wide shadow-sm {} {}", badge_class, class.unwrap_or(""));
    let full_class = format!("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 {} {}", badge_variant_classes(variant), combined_class);
    view! {
        <div
            class=full_class
        >
            <span aria-label=label.to_string()>{label}</span>
        </div>
    }
}

fn badge_variant_classes(variant: crate::components::ui::BadgeVariant) -> &'static str {
    match variant {
        crate::components::ui::BadgeVariant::Default => "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        crate::components::ui::BadgeVariant::Secondary => "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        crate::components::ui::BadgeVariant::Destructive => "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        crate::components::ui::BadgeVariant::Outline => "text-foreground",
    }
}
