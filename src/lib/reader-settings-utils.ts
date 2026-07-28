import type { ReaderSettings } from "../components/reader/ReaderSettings";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "system",
  fontFamily: "merriweather",
  fontSize: "16",
  contentPadding: "24",
};

/** Map legacy labels or clamp numeric font sizes to the reader scale. */
export function normalizeFontSize(value: string | undefined): string {
  switch (value) {
    case "small":
      return "14";
    case "medium":
      return "16";
    case "large":
      return "18";
    case "xlarge":
      return "20";
    default: {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return String(Math.min(28, Math.max(12, Math.round(parsed))));
      }
      return DEFAULT_READER_SETTINGS.fontSize;
    }
  }
}

/** Map legacy padding labels or clamp numeric padding to even px values. */
export function normalizeContentPadding(value: string | undefined): string {
  switch (value) {
    case "compact":
      return "16";
    case "comfortable":
      return "24";
    case "spacious":
      return "48";
    default: {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return String(Math.min(64, Math.max(8, Math.round(parsed / 2) * 2)));
      }
      return DEFAULT_READER_SETTINGS.contentPadding;
    }
  }
}
