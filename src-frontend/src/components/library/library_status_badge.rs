use leptos::*;
use crate::components::library::types::LibraryBookStatus;

#[component]
pub fn LibraryStatusBadge(
    status: LibraryBookStatus,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    let badge_class = match status {
        LibraryBookStatus::New => "bg-emerald-500 text-white border-transparent",
        LibraryBookStatus::Resume => "bg-amber-500 text-white border-transparent",
        LibraryBookStatus::Finished => "bg-blue-500 text-white border-transparent",
    };

    let label = status.label();
    let combined_class = format!("pointer-events-none text-[10px] uppercase tracking-wide shadow-sm {} {}", badge_class, class.unwrap_or(""));
    let full_class = format!("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 {}", combined_class);
    view! {
        <div
            class=full_class
        >
            <span aria-label=label.to_string()>{label}</span>
        </div>
    }
}
