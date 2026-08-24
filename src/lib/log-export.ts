import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { type as osType } from "@tauri-apps/plugin-os";

import { getLogs, type LogEntry } from "./logger";

export function formatLogsForExport(logs: LogEntry[] = getLogs()): string {
  return logs
    .map(
      (log) =>
        `[${log.timestamp}] [${log.source.toUpperCase()}] [${log.level.toUpperCase()}] ${log.message}${
          log.data != null ? ` ${JSON.stringify(log.data, null, 2)}` : ""
        }`
    )
    .join("\n");
}

export function defaultLogFilename(): string {
  return `aurorabook-logs-${new Date().toISOString().replace(/:/g, "-")}.txt`;
}

/**
 * Save the full log file using the same platform rules as book export:
 * - macOS / Windows: native save dialog, then write to the chosen path
 * - iOS: write under Documents/Exports and present the share sheet
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
      filters: [{ name: "Log files", extensions: ["txt"] }],
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

/** Open Mail with the full log file attached (iOS MessageUI / .eml share; desktop .eml draft). */
export async function emailLogsReport(options: {
  to: string;
  subject: string;
  body: string;
  logs?: LogEntry[];
}): Promise<void> {
  const contents = formatLogsForExport(options.logs ?? getLogs());
  await invoke("email_logs_report", {
    contents: contents || "(no logs captured)\n",
    to: options.to,
    subject: options.subject,
    body: options.body,
  });
}
