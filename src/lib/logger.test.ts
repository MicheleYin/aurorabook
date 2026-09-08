import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitTauriEvent, invoke, listen } from "../test/tauri-mocks";

type LoggerModule = typeof import("./logger");

async function loadLogger(): Promise<LoggerModule> {
  vi.resetModules();
  return import("./logger");
}

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_app_logs") return [];
      return undefined;
    });
  });

  it("captures log entries and notifies subscribers", async () => {
    const { getLogs, logger, subscribeToLogs } = await loadLogger();
    const listener = vi.fn();
    const unsubscribe = subscribeToLogs(listener);

    logger.info("hello", { chapter: 1 });

    const logs = getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "info",
      source: "frontend",
      message: 'hello {\n  "chapter": 1\n}',
      data: [{ chapter: 1 }],
    });
    expect(logs[0].timestamp).toMatch(/T/);
    expect(listener).toHaveBeenCalledWith(logs);

    unsubscribe();
    logger.log("after unsubscribe");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("formats errors and falls back to String for unserializable values", async () => {
    const { getLogs, logger } = await loadLogger();
    const error = new Error("boom");
    const circular: { self?: unknown } = {};
    circular.self = circular;

    logger.error(error);
    logger.warn(circular);

    const logs = getLogs();
    expect(logs[0].message).toContain("boom");
    expect(logs[0].message).toContain("Error: boom");
    expect(logs[1].message).toBe("[object Object]");
  });

  it("keeps only the latest 1000 log entries", async () => {
    const { getLogs, logger } = await loadLogger();

    for (let index = 0; index < 1002; index += 1) {
      logger.debug(`entry-${index}`);
    }

    const logs = getLogs();
    expect(logs).toHaveLength(1000);
    expect(logs[0].message).toBe("entry-2");
    expect(logs[logs.length - 1]?.message).toBe("entry-1001");
  });

  it("clears the shared log store", async () => {
    const { clearLogs, getLogs, logger } = await loadLogger();
    logger.error("keep me");
    expect(getLogs()).toHaveLength(1);
    clearLogs();
    expect(getLogs()).toHaveLength(0);
  });

  it("appends backend entries into the shared store", async () => {
    const { appendLogEntry, getLogs } = await loadLogger();
    appendLogEntry({
      level: "error",
      source: "backend",
      message: "WebGPU session failed",
    });
    const logs = getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      source: "backend",
      message: "WebGPU session failed",
    });
  });

  it("swallows listener failures and routes each level to the matching console method", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const { logger, subscribeToLogs } = await loadLogger();
    subscribeToLogs(() => {
      throw new Error("listener failure");
    });

    logger.log("plain");
    logger.info("info");
    logger.warn("warn");
    logger.debug("debug");
    logger.error("error");

    expect(logSpy).toHaveBeenCalledWith("plain");
    expect(infoSpy).toHaveBeenCalledWith("info");
    expect(warnSpy).toHaveBeenCalledWith("warn");
    expect(debugSpy).toHaveBeenCalledWith("debug");
    expect(errorSpy).toHaveBeenCalledWith(
      "Error in log listener:",
      expect.any(Error)
    );
    expect(errorSpy).toHaveBeenCalledWith("error");
  });

  it("hydrates persisted logs and normalizes stored levels/sources", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_app_logs") {
        return [
          {
            timestamp: "2024-01-01T00:00:00.000Z",
            level: "warning",
            source: "backend",
            message: "persisted warning",
          },
          {
            timestamp: "2024-01-01T00:00:01.000Z",
            level: "trace",
            source: "unknown-source",
            message: "persisted trace",
          },
          {
            timestamp: "2024-01-01T00:00:02.000Z",
            level: "totally-unknown",
            source: "frontend",
            message: "persisted default",
          },
        ];
      }
      return undefined;
    });

    const { getLogs, hydrateLogsFromDb, logger } = await loadLogger();

    // Entry logged before hydration resolves should be preserved after merge.
    logger.log("live entry");

    await hydrateLogsFromDb();
    // A second call must be a no-op once already hydrated.
    await hydrateLogsFromDb();

    const logs = getLogs();
    expect(logs).toHaveLength(4);
    expect(logs[0]).toMatchObject({ level: "warn", source: "backend" });
    expect(logs[1]).toMatchObject({ level: "debug", source: "frontend" });
    expect(logs[2]).toMatchObject({ level: "log", source: "frontend" });
    expect(logs[3].message).toBe("live entry");
    expect(invoke).toHaveBeenCalledWith("list_app_logs");
  });

  it("logs an error when hydration fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_app_logs") {
        throw new Error("db unavailable");
      }
      return undefined;
    });

    const { hydrateLogsFromDb } = await loadLogger();
    await hydrateLogsFromDb();

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to hydrate logs from database:",
      expect.any(Error)
    );
  });

  it("starts the backend log bridge and appends bridged entries without re-persisting", async () => {
    const { getLogs, startBackendLogBridge } = await loadLogger();

    startBackendLogBridge();
    // Second call should not attach a duplicate listener.
    startBackendLogBridge();
    await Promise.resolve();

    emitTauriEvent("backend-log", {
      timestamp: "2024-02-02T00:00:00.000Z",
      level: "warning",
      source: "backend",
      message: "from backend",
    });

    const logs = getLogs();
    const bridged = logs.find((log) => log.message === "from backend");
    expect(bridged).toMatchObject({ level: "warn", source: "backend" });
    expect(invoke).not.toHaveBeenCalledWith(
      "append_app_log",
      expect.anything()
    );
  });

  it("recovers if the backend log listener fails to attach", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listen.mockRejectedValueOnce(new Error("listen failed"));

    const { startBackendLogBridge } = await loadLogger();
    startBackendLogBridge();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to set up backend log listener:",
      expect.any(Error)
    );
  });
});
