/// Merge class names (similar to clsx + tailwind-merge)
/// This is a simplified version - for full functionality, consider using a WASM wrapper
pub fn cn(classes: &[&str]) -> String {
    classes
        .iter()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Helper to conditionally include classes
pub fn class_if(condition: bool, class: &str) -> String {
    if condition {
        class.to_string()
    } else {
        String::new()
    }
}
