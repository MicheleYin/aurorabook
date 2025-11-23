import type { ReaderPreferences } from "../../types/reader";

export const BASE_FONT_CLASS = "text-[18px]";
export const BASE_LINE_HEIGHT_CLASS = "leading-[1.6]";
export const themeClasses: Record<ReaderPreferences["theme"], string> = {
  light: "bg-white text-slate-900",
  dark: "bg-zinc-950 text-zinc-100",
  sepia: "bg-[#f4ecd8] text-[#403127]",
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

export const fontOptions: Array<{ id: ReaderPreferences["fontFamily"]; label: string }> = [
  { id: "merriweather", label: "Merriweather" },
  { id: "inter", label: "Inter" },
  { id: "lora", label: "Lora" },
  { id: "firaMono", label: "Fira Mono" },
  { id: "atkinson", label: "Atkinson" },
];

export const themeOptions: Array<{ id: ReaderPreferences["theme"]; label: string }> = [
  { id: "light", label: "Light" },
  { id: "sepia", label: "Sepia" },
  { id: "dark", label: "Dark" },
];
