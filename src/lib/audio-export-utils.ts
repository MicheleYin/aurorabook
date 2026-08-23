export type AudioExportFormat = "mp3" | "m4a" | "m4b";

export const ALL_AUDIO_EXPORT_FORMATS: AudioExportFormat[] = ["mp3", "m4a", "m4b"];

/** Accept only known audiobook export formats from backend status payloads. */
export function normalizeFormat(f: string | null): AudioExportFormat | null {
  if (f === "mp3" || f === "m4a" || f === "m4b") {
    return f;
  }
  return null;
}

/** Parse `get_supported_audio_export_formats` payloads; fall back to full parity list. */
export function parseSupportedAudioExportFormats(
  raw: unknown
): AudioExportFormat[] {
  if (!Array.isArray(raw)) {
    return [...ALL_AUDIO_EXPORT_FORMATS];
  }
  const parsed = raw
    .map((item) => (typeof item === "string" ? normalizeFormat(item) : null))
    .filter((f): f is AudioExportFormat => f !== null);
  return parsed.length > 0 ? parsed : [...ALL_AUDIO_EXPORT_FORMATS];
}

/**
 * Linear ETA from tracks completed; `startedAtMs` is wall time when encode/export work began.
 * Returns null when there is not enough progress to estimate, or 0 when finished.
 */
export function linearAudioExportEtaMs(
  startedAtMs: number,
  processedTracks: number,
  totalTracks: number,
  nowMs: number = Date.now()
): number | null {
  if (totalTracks <= 0 || processedTracks <= 0) {
    return null;
  }
  if (processedTracks >= totalTracks) {
    return 0;
  }
  const elapsed = Math.max(1, nowMs - startedAtMs);
  const rate = processedTracks / elapsed;
  if (!Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return (totalTracks - processedTracks) / rate;
}

/** Terminal steps that mean the export UI should stop polling / clear progress. */
export function isTerminalExportStep(step: string): boolean {
  return step === "completed" || step === "cancelled";
}
