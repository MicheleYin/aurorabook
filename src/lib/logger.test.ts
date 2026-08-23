import { beforeEach, describe, expect, it, vi } from "vitest";

type LoggerModule = typeof import("./logger");

async function loadLogger(): Promise<LoggerModule> {
  vi.resetModules();
  return import("./logger");
}

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
