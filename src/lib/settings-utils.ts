import type { TtsSynthesisQuality } from "../types/settings";

/** Accept only known TTS quality presets; default to balanced. */
export function normalizeTtsSynthesisQuality(
  value: unknown
): TtsSynthesisQuality {
  if (value === "fastest" || value === "balanced" || value === "quality") {
    return value;
  }
  return "balanced";
}
