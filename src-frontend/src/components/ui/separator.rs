use leptos::*;
use crate::components::ui::utils::cn;

#[derive(Clone, Copy, PartialEq)]
pub enum SeparatorOrientation {
    Horizontal,
    Vertical,
}

#[component]
pub fn Separator(
    #[prop(optional)] orientation: Option<SeparatorOrientation>,
    #[prop(optional)] class: Option<&'static str>,
) -> impl IntoView {
    let orientation = orientation.unwrap_or(SeparatorOrientation::Horizontal);
    
    let base_classes = "shrink-0 bg-border";
    let orientation_classes = match orientation {
        SeparatorOrientation::Horizontal => "h-[1px] w-full",
        SeparatorOrientation::Vertical => "h-full w-[1px]",
    };
    
    let classes = cn(&[base_classes, orientation_classes, class.unwrap_or("")]);
    
    view! {
        <div
            class=classes
            role="separator"
            aria-orientation=if matches!(orientation, SeparatorOrientation::Horizontal) { "horizontal" } else { "vertical" }
        />
    }
}
