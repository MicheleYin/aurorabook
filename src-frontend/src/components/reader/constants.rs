use crate::types::reader::{ReaderFont, ReaderFontSize, ReaderContentPadding, ReaderTheme};

pub struct ReaderConstants;

impl ReaderConstants {
    pub fn font_class(font: &ReaderFont) -> &'static str {
        match font {
            ReaderFont::Merriweather => "font-merriweather",
            ReaderFont::Inter => "font-inter",
            ReaderFont::Lora => "font-lora",
            ReaderFont::FiraMono => "font-fira-mono",
            ReaderFont::Atkinson => "font-readable",
        }
    }

    pub fn font_size_class(size: &ReaderFontSize) -> &'static str {
        match size {
            ReaderFontSize::Small => "text-[16px]",
            ReaderFontSize::Medium => "text-[18px]",
            ReaderFontSize::Large => "text-[20px]",
            ReaderFontSize::XLarge => "text-[22px]",
        }
    }

    pub fn line_height_class(size: &ReaderFontSize) -> &'static str {
        match size {
            ReaderFontSize::Small => "leading-[1.6]",
            ReaderFontSize::Medium => "leading-[1.6]",
            ReaderFontSize::Large => "leading-[1.65]",
            ReaderFontSize::XLarge => "leading-[1.7]",
        }
    }

    pub fn content_padding_outer(padding: &ReaderContentPadding) -> &'static str {
        match padding {
            ReaderContentPadding::Compact => "px-4 py-6",
            ReaderContentPadding::Comfortable => "px-6 py-10",
            ReaderContentPadding::Spacious => "px-10 py-14",
        }
    }

    pub fn content_padding_inner_base(padding: &ReaderContentPadding) -> &'static str {
        match padding {
            ReaderContentPadding::Compact => "px-4",
            ReaderContentPadding::Comfortable => "px-6",
            ReaderContentPadding::Spacious => "px-8",
        }
    }

    pub fn content_padding_inner_chrome(padding: &ReaderContentPadding) -> &'static str {
        match padding {
            ReaderContentPadding::Compact => "py-6",
            ReaderContentPadding::Comfortable => "py-10",
            ReaderContentPadding::Spacious => "py-12",
        }
    }

    pub fn content_padding_inner_immersive(padding: &ReaderContentPadding) -> &'static str {
        match padding {
            ReaderContentPadding::Compact => "py-4",
            ReaderContentPadding::Comfortable => "py-6",
            ReaderContentPadding::Spacious => "py-8",
        }
    }
}

pub struct FontOption {
    pub id: ReaderFont,
    pub label: &'static str,
}

pub fn font_options() -> Vec<FontOption> {
    vec![
        FontOption { id: ReaderFont::Merriweather, label: "Merriweather" },
        FontOption { id: ReaderFont::Inter, label: "Inter" },
        FontOption { id: ReaderFont::Lora, label: "Lora" },
        FontOption { id: ReaderFont::FiraMono, label: "Fira Mono" },
        FontOption { id: ReaderFont::Atkinson, label: "Atkinson" },
    ]
}

pub struct FontSizeOption {
    pub id: ReaderFontSize,
    pub label: &'static str,
    pub description: &'static str,
}

pub fn font_size_options() -> Vec<FontSizeOption> {
    vec![
        FontSizeOption { id: ReaderFontSize::Small, label: "Small", description: "Compact text" },
        FontSizeOption { id: ReaderFontSize::Medium, label: "Default", description: "Balanced reading" },
        FontSizeOption { id: ReaderFontSize::Large, label: "Large", description: "Comfortable text" },
        FontSizeOption { id: ReaderFontSize::XLarge, label: "Extra large", description: "Maximum size" },
    ]
}

pub struct ContentPaddingOption {
    pub id: ReaderContentPadding,
    pub label: &'static str,
    pub description: &'static str,
}

pub fn content_padding_options() -> Vec<ContentPaddingOption> {
    vec![
        ContentPaddingOption { id: ReaderContentPadding::Compact, label: "Compact", description: "More words per line" },
        ContentPaddingOption { id: ReaderContentPadding::Comfortable, label: "Comfortable", description: "Balanced margins" },
        ContentPaddingOption { id: ReaderContentPadding::Spacious, label: "Spacious", description: "Wide breathing room" },
    ]
}

pub struct ThemeOption {
    pub id: ReaderTheme,
    pub label: &'static str,
}

pub fn theme_options() -> Vec<ThemeOption> {
    vec![
        ThemeOption { id: ReaderTheme::System, label: "System" },
        ThemeOption { id: ReaderTheme::Light, label: "Light" },
        ThemeOption { id: ReaderTheme::Dark, label: "Dark" },
    ]
}


