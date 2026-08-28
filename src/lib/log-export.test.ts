import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LogEntry } from "./logger";
import { invoke, osType } from "../test/tauri-mocks";
import {
  defaultLogFilename,
  emailLogsReport,
  exportLogsToFile,
  formatLogsForExport,
  logsForExport,
  MAX_EXPORT_LOGS,
} from "./log-export";
import { clearLogs, logger } from "./logger";

const { save } = await import("@tauri-apps/plugin-dialog");

describe("log-export", () => {
  beforeEach(() => {
    clearLogs();
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    osType.mockReset();
    osType.mockReturnValue("macos");
    (save as ReturnType<typeof vi.fn>).mockReset();
  });

  it("keeps only the most recent MAX_EXPORT_LOGS entries", () => {
    const logs: LogEntry[] = Array.from(
      { length: MAX_EXPORT_LOGS + 10 },
      (_, i) => ({
        timestamp: `t${i}`,
        level: "log",
        source: "frontend",
        message: `entry-${i}`,
      })
    );

    const trimmed = logsForExport(logs);
    expect(trimmed).toHaveLength(MAX_EXPORT_LOGS);
    expect(trimmed[0].message).toBe("entry-10");
  });

  it("formats logs including JSON data", () => {
    const logs: LogEntry[] = [
      {
        timestamp: "2024-01-01T00:00:00.000Z",
        level: "error",
        source: "backend",
        message: "boom",
        data: { code: 1 },
      },
    ];

    const formatted = formatLogsForExport(logs);
    expect(formatted).toContain("[2024-01-01T00:00:00.000Z]");
    expect(formatted).toContain("[BACKEND]");
    expect(formatted).toContain("[ERROR]");
    expect(formatted).toContain("boom");
    expect(formatted).toContain('"code": 1');
  });

  it("builds a default filename with a timestamp", () => {
    const name = defaultLogFilename();
    expect(name).toMatch(/^aurorabook-logs-.*\.zip$/);
    expect(name).not.toContain(":");
  });

  it("exports logs via native save dialog on desktop", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/logs.zip");
    logger.info("hello");

    const result = await exportLogsToFile();

    expect(result).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "export_logs_to_file",
      expect.objectContaining({ outputPath: "/tmp/logs.zip" })
    );
  });

  it("returns false when the save dialog is cancelled", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await exportLogsToFile();

    expect(result).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith(
      "export_logs_to_file",
      expect.anything()
    );
  });

  it("writes with a default filename and no dialog on iOS", async () => {
    osType.mockReturnValue("ios");

    const result = await exportLogsToFile([]);

    expect(result).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "export_logs_to_file",
      expect.objectContaining({ contents: "(no logs captured)\n" })
    );
  });

  it("emails a bug report with attached logs on desktop", async () => {
    logger.error("crash");

    await emailLogsReport({
      to: "support@example.com",
      subject: "Bug",
      body: "details",
    });

    expect(invoke).toHaveBeenCalledWith(
      "email_logs_report",
      expect.objectContaining({
        to: "support@example.com",
        subject: "Bug",
        body: "details",
      })
    );
  });

  it("omits log contents when emailing from iOS", async () => {
    osType.mockReturnValue("ios");

    await emailLogsReport({ to: "a@b.com", subject: "s", body: "b" });

    expect(invoke).toHaveBeenCalledWith(
      "email_logs_report",
      expect.objectContaining({ contents: "" })
    );
  });
});
