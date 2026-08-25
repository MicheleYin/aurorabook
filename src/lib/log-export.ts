import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { type as osType } from "@tauri-apps/plugin-os";

import { getLogs, type LogEntry } from "./logger";

/** Only the most recent entries are included in file/email export. */
export const MAX_EXPORT_LOGS = 100;

export function logsForExport(logs: LogEntry[] = getLogs()): LogEntry[] {
  return logs.length > MAX_EXPORT_LOGS
    ? logs.slice(-MAX_EXPORT_LOGS)
    : logs;
}

export function formatLogsForExport(logs: LogEntry[] = getLogs()): string {
  return logsForExport(logs)
    .map(
      (log) =>
        `[${log.timestamp}] [${log.source.toUpperCase()}] [${log.level.toUpperCase()}] ${log.message}${
          log.data != null ? ` ${JSON.stringify(log.data, null, 2)}` : ""
        }`
    )
    .join("\n");
}

export function defaultLogFilename(): string {
  return `aurorabook-logs-${new Date().toISOString().replace(/:/g, "-")}.zip`;
}

/**
 * Save the log archive using the same platform rules as book export:
 * - macOS / Windows: native save dialog, then write to the chosen path
 * - iOS: write under Documents/Exports and present the share sheet
 *
 * The backend zips a `.txt` of the last {@link MAX_EXPORT_LOGS} entries.
 */
export async function exportLogsToFile(
  logs: LogEntry[] = getLogs()
): Promise<boolean> {
  const contents = formatLogsForExport(logs);
  const suggestedName = defaultLogFilename();
  let outputPath = suggestedName;

  const onIos = (await osType()) === "ios";
  if (!onIos) {
    const chosen = await save({
      defaultPath: suggestedName,
      filters: [{ name: "Zip archives", extensions: ["zip"] }],
    });
    if (!chosen) {
      return false;
    }
    outputPath = chosen;
  }

  await invoke("export_logs_to_file", {
    contents: contents || "(no logs captured)\n",
    outputPath,
  });
  return true;
}

/**
 * Open a bug-report email:
 * - desktop: `.eml` draft with zipped logs attached
 * - iOS: default mail app via `mailto:` (no attachment)
 */
export async function emailLogsReport(options: {
  to: string;
  subject: string;
  body: string;
  logs?: LogEntry[];
}): Promise<void> {
  const onIos = (await osType()) === "ios";
  const contents = onIos
    ? ""
    : formatLogsForExport(options.logs ?? getLogs()) || "(no logs captured)\n";
  await invoke("email_logs_report", {
    contents,
    to: options.to,
    subject: options.subject,
    body: options.body,
  });
}
