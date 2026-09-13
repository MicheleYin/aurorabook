import type {
  AppTab,
  LibraryViewMode,
  TtsSynthesisQuality,
} from "../types/settings";

/** iOS prefers speed; other platforms keep balanced. */
export function defaultTtsSynthesisQuality(): TtsSynthesisQuality {
  if (
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent)
  ) {
    return "fastest";
  }
  return "balanced";
}

/** Accept only known TTS quality presets; otherwise use the platform default. */
export function normalizeTtsSynthesisQuality(
  value: unknown
): TtsSynthesisQuality {
  if (value === "fastest" || value === "balanced" || value === "quality") {
    return value;
  }
  return defaultTtsSynthesisQuality();
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
