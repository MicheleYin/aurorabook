/**
 * Logger utility that captures logs for the in-app log viewer.
 * Frontend + backend entries share one store so device debugging works offline.
 */

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

export function getLogs(): LogEntry[] {
  return [...logStore];
}

export function clearLogs(): void {
  logStore = [];
  notifyListeners();
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

function pushLog(entry: LogEntry): void {
  logStore.push(entry);
  if (logStore.length > MAX_LOGS) {
    logStore = logStore.slice(-MAX_LOGS);
  }
  notifyListeners();
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

/** Append a backend (or other) log entry into the shared store. */
export function appendLogEntry(entry: Omit<LogEntry, "timestamp"> & { timestamp?: string }): void {
  pushLog({
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: normalizeLevel(entry.level),
    source: entry.source,
    message: entry.message,
    data: entry.data,
  });
}

/**
 * Start listening for `backend-log` events once (app lifetime).
 * Safe to call multiple times; only the first call attaches.
 */
export function startBackendLogBridge(): void {
  if (backendListenerStarted) return;
  backendListenerStarted = true;

  void listen<LogEntry>("backend-log", (event) => {
    const payload = event.payload;
    appendLogEntry({
      timestamp: payload.timestamp,
      level: normalizeLevel(payload.level),
      source: "backend",
      message: payload.message,
      data: payload.data,
    });
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
