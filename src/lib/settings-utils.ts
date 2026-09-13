import type {
  AppTab,
  LibraryViewMode,
  TtsSynthesisQuality,
} from "../types/settings";

/** Accept only known TTS quality presets; default to balanced. */
export function normalizeTtsSynthesisQuality(
  value: unknown
): TtsSynthesisQuality {
  if (value === "fastest" || value === "balanced" || value === "quality") {
    return value;
  }
  return "balanced";
}

export function normalizeAppTab(value: unknown): AppTab {
  if (value === "library" || value === "reader" || value === "settings") {
    return value;
  }
  return "library";
}

export function normalizeLibraryViewMode(value: unknown): LibraryViewMode {
  if (value === "list" || value === "grid") {
    return value;
  }
  return "grid";
}

export function normalizeOptionalBookId(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}
