/**
 * Logger utility that captures logs for the in-app log viewer.
 * Frontend + backend entries share one store; rows also live in SQLite
 * (auto-cleaned after 24 hours).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface LogEntry {
  timestamp: string;
  level: "log" | "info" | "warn" | "error" | "debug";
  source: "frontend" | "backend";
  message: string;
  data?: unknown;
}

const MAX_LOGS = 1000;

let logStore: LogEntry[] = [];
const logStoreListeners: Set<(logs: LogEntry[]) => void> = new Set();
let backendListenerStarted = false;
let persistenceHydrated = false;
let hydratePromise: Promise<void> | null = null;

export function getLogs(): LogEntry[] {
  return [...logStore];
}

export function clearLogs(): void {
  logStore = [];
  notifyListeners();
  void invoke("clear_app_logs").catch((error) => {
    console.error("Failed to clear persisted logs:", error);
  });
}

export function subscribeToLogs(
  callback: (logs: LogEntry[]) => void
): () => void {
  logStoreListeners.add(callback);
  return () => {
    logStoreListeners.delete(callback);
  };
}

function notifyListeners(): void {
  const snapshot = [...logStore];
  logStoreListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("Error in log listener:", error);
    }
  });
}

function pushLog(entry: LogEntry, options?: { persist?: boolean }): void {
  logStore.push(entry);
  if (logStore.length > MAX_LOGS) {
    logStore = logStore.slice(-MAX_LOGS);
  }
  notifyListeners();

  if (options?.persist === false) {
    return;
  }

  // Backend rows are written by Rust; only persist frontend-originated entries here.
  if (entry.source !== "frontend") {
    return;
  }

  void invoke("append_app_log", {
    entry: {
      timestamp: entry.timestamp,
      level: entry.level,
      source: entry.source,
      message: entry.message,
      data: entry.data ?? null,
    },
  }).catch((error) => {
    console.error("Failed to persist log:", error);
  });
}

function normalizeLevel(level: string): LogEntry["level"] {
  switch (level) {
    case "error":
    case "warn":
    case "info":
    case "debug":
    case "log":
      return level;
    case "warning":
      return "warn";
    case "trace":
      return "debug";
    default:
      return "log";
  }
}

function normalizeSource(source: string): LogEntry["source"] {
  return source === "backend" ? "backend" : "frontend";
}

function mapPersistedEntry(raw: {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  data?: unknown;
}): LogEntry {
  return {
    timestamp: raw.timestamp,
    level: normalizeLevel(raw.level),
    source: normalizeSource(raw.source),
    message: raw.message,
    data: raw.data,
  };
}

/** Append a backend (or other) log entry into the shared store. */
export function appendLogEntry(
  entry: Omit<LogEntry, "timestamp"> & { timestamp?: string },
  options?: { persist?: boolean }
): void {
  pushLog(
    {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      level: normalizeLevel(entry.level),
      source: entry.source,
      message: entry.message,
      data: entry.data,
    },
    options
  );
}

/**
 * Load persisted logs from SQLite (runs cleanup older than 24h on the backend).
 * Safe to call multiple times; only the first load replaces the in-memory store.
 */
export async function hydrateLogsFromDb(): Promise<void> {
  if (persistenceHydrated) {
    return;
  }
  if (hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    try {
      const rows = await invoke<
        Array<{
          timestamp: string;
          level: string;
          source: string;
          message: string;
          data?: unknown;
        }>
      >("list_app_logs");
      const mapped = rows.map(mapPersistedEntry);
      // Keep any entries that arrived while the DB load was in flight.
      const live = logStore;
      const seen = new Set(
        mapped.map(
          (entry) => `${entry.timestamp}|${entry.source}|${entry.message}`
        )
      );
      const merged = [
        ...mapped,
        ...live.filter(
          (entry) =>
            !seen.has(`${entry.timestamp}|${entry.source}|${entry.message}`)
        ),
      ];
      logStore = merged.slice(-MAX_LOGS);
      persistenceHydrated = true;
      notifyListeners();
    } catch (error) {
      console.error("Failed to hydrate logs from database:", error);
    } finally {
      hydratePromise = null;
    }
  })();

  return hydratePromise;
}

/**
 * Start listening for `backend-log` events once (app lifetime).
 * Also hydrates the viewer from SQLite.
 * Safe to call multiple times; only the first call attaches.
 */
export function startBackendLogBridge(): void {
  void hydrateLogsFromDb();

  if (backendListenerStarted) return;
  backendListenerStarted = true;

  void listen<LogEntry>("backend-log", (event) => {
    const payload = event.payload;
    appendLogEntry(
      {
        timestamp: payload.timestamp,
        level: normalizeLevel(payload.level),
        source: "backend",
        message: payload.message,
        data: payload.data,
      },
      // Already persisted by the Rust logger.
      { persist: false }
    );
  }).catch((error) => {
    backendListenerStarted = false;
    console.error("Failed to set up backend log listener:", error);
  });
}

function addLog(level: LogEntry["level"], ...args: unknown[]): void {
  const message = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    })
    .join(" ");

  pushLog({
    timestamp: new Date().toISOString(),
    level,
    source: "frontend",
    message,
    data: args.length > 1 ? args.slice(1) : undefined,
  });

  const consoleMethod =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : level === "info"
            ? console.info
            : console.log;
  consoleMethod(...args);
}

interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

export const logger: Logger = {
  log: (...args: unknown[]) => addLog("log", ...args),
  error: (...args: unknown[]) => addLog("error", ...args),
  warn: (...args: unknown[]) => addLog("warn", ...args),
  debug: (...args: unknown[]) => addLog("debug", ...args),
  info: (...args: unknown[]) => addLog("info", ...args),
};
