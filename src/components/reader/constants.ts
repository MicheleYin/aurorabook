import type { ReaderPreferences } from "../../types/reader";

type ResolvedReaderTheme = Exclude<ReaderPreferences["theme"], "system">;

export const themeClasses: Record<ResolvedReaderTheme, string> = {
  light: "bg-background text-foreground",
  dark: "bg-background text-foreground",
};

export const fontClassMap: Record<ReaderPreferences["fontFamily"], string> = {
  merriweather: "font-merriweather",
  inter: "font-inter",
  lora: "font-lora",
  firaMono: "font-fira-mono",
  atkinson: "font-readable",
};

export const fontPreviewText: Record<ReaderPreferences["fontFamily"], string> = {
  merriweather: "Aa",
  inter: "Aa",
  lora: "Aa",
  firaMono: "Aa",
  atkinson: "Aa",
};

export const fontSizeClassMap: Record<ReaderPreferences["fontSize"], string> = {
  small: "text-[16px]",
  medium: "text-[18px]",
  large: "text-[20px]",
  xlarge: "text-[22px]",
};

export const lineHeightClassMap: Record<ReaderPreferences["fontSize"], string> = {
  small: "leading-[1.6]",
  medium: "leading-[1.6]",
  large: "leading-[1.65]",
  xlarge: "leading-[1.7]",
};

export const fontSizeTokenClassMap: Record<
  ReaderPreferences["fontSize"],
  string
> = {
  small: "reader-size-small",
  medium: "reader-size-medium",
  large: "reader-size-large",
  xlarge: "reader-size-xlarge",
};

export const fontSizeValueMap: Record<ReaderPreferences["fontSize"], number> = {
  small: 16,
  medium: 18,
  large: 20,
  xlarge: 22,
};

export const lineHeightValueMap: Record<ReaderPreferences["fontSize"], number> = {
  small: 1.6,
  medium: 1.6,
  large: 1.65,
  xlarge: 1.7,
};

export const fontOptions: Array<{ id: ReaderPreferences["fontFamily"]; label: string }> = [
  { id: "merriweather", label: "Merriweather" },
  { id: "inter", label: "Inter" },
  { id: "lora", label: "Lora" },
  { id: "firaMono", label: "Fira Mono" },
  { id: "atkinson", label: "Atkinson" },
];

export const fontSizeOptions: Array<{
  id: ReaderPreferences["fontSize"];
  label: string;
  description: string;
}> = [
  { id: "small", label: "Small", description: "Compact text" },
  { id: "medium", label: "Default", description: "Balanced reading" },
  { id: "large", label: "Large", description: "Comfortable text" },
  { id: "xlarge", label: "Extra large", description: "Maximum size" },
];

export const contentPaddingOptions: Array<{
  id: ReaderPreferences["contentPadding"];
  label: string;
  description: string;
}> = [
  { id: "compact", label: "Compact", description: "More words per line" },
  { id: "comfortable", label: "Comfortable", description: "Balanced margins" },
  { id: "spacious", label: "Spacious", description: "Wide breathing room" },
];

export const contentPaddingConfigMap: Record<
  ReaderPreferences["contentPadding"],
  {
    outer: string;
    innerBase: string;
    innerChrome: string;
    innerImmersive: string;
  }
> = {
  compact: {
    outer: "px-4 py-6",
    innerBase: "px-4",
    innerChrome: "py-6",
    innerImmersive: "py-4",
  },
  comfortable: {
    outer: "px-6 py-10",
    innerBase: "px-6",
    innerChrome: "py-10",
    innerImmersive: "py-6",
  },
  spacious: {
    outer: "px-10 py-14",
    innerBase: "px-8",
    innerChrome: "py-12",
    innerImmersive: "py-8",
  },
};

export const themeOptions: Array<{ id: ReaderPreferences["theme"]; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

