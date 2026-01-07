/**
 * Logger utility that captures logs for the log viewer
 * Always enabled to capture logs for debugging
 */

import type { LogEntry } from "../components/debug/LogViewer";

// Global log store for the log viewer
let logStore: LogEntry[] = [];
const logStoreListeners: Set<(logs: LogEntry[]) => void> = new Set();

export function getLogs(): LogEntry[] {
  return [...logStore];
}

export function subscribeToLogs(
  callback: (logs: LogEntry[]) => void
): () => void {
  logStoreListeners.add(callback);
  return () => {
    logStoreListeners.delete(callback);
  };
}

function addLog(level: LogEntry["level"], ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
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

  const logEntry: LogEntry = {
    timestamp,
    level,
    source: "frontend",
    message,
    data: args.length > 1 ? args.slice(1) : undefined,
  };

  // Add to store
  logStore.push(logEntry);
  // Keep only last 1000 logs
  if (logStore.length > 1000) {
    logStore = logStore.slice(-1000);
  }

  // Notify listeners
  logStoreListeners.forEach((listener) => {
    try {
      listener([...logStore]);
    } catch (error) {
      console.error("Error in log listener:", error);
    }
  });

  // Also log to console
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
