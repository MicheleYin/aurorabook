import { useEffect, useState } from "react";

import { exportLogsToFile } from "../../lib/log-export";
import {
  clearLogs as clearLogStore,
  getLogs,
  logger,
  startBackendLogBridge,
  subscribeToLogs,
  type LogEntry,
} from "../../lib/logger";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export type { LogEntry };

interface LogViewerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

type SourceFilter = "all" | "frontend" | "backend";
type LevelFilter = "all" | "log" | "info" | "warn" | "error" | "debug";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function levelStyles(level: LogEntry["level"]): string {
  switch (level) {
    case "error":
      return "border-l-red-600 bg-red-50 text-red-950 dark:border-l-red-400 dark:bg-red-950/55 dark:text-red-50";
    case "warn":
      return "border-l-amber-600 bg-amber-50 text-amber-950 dark:border-l-amber-400 dark:bg-amber-950/55 dark:text-amber-50";
    case "info":
      return "border-l-sky-600 bg-sky-50 text-sky-950 dark:border-l-sky-400 dark:bg-sky-950/55 dark:text-sky-50";
    case "debug":
      return "border-l-zinc-500 bg-zinc-100 text-zinc-900 dark:border-l-zinc-400 dark:bg-zinc-900/70 dark:text-zinc-100";
    default:
      return "border-l-zinc-500 bg-zinc-50 text-zinc-900 dark:border-l-zinc-400 dark:bg-zinc-900/50 dark:text-zinc-100";
  }
}

function levelBadgeStyles(level: LogEntry["level"]): string {
  switch (level) {
    case "error":
      return "border-red-700/50 bg-red-100 text-red-800 dark:border-red-400/50 dark:bg-red-950/80 dark:text-red-200";
    case "warn":
      return "border-amber-700/50 bg-amber-100 text-amber-900 dark:border-amber-400/50 dark:bg-amber-950/80 dark:text-amber-200";
    case "info":
      return "border-sky-700/50 bg-sky-100 text-sky-900 dark:border-sky-400/50 dark:bg-sky-950/80 dark:text-sky-200";
    case "debug":
      return "border-zinc-600/50 bg-zinc-200 text-zinc-800 dark:border-zinc-400/50 dark:bg-zinc-800 dark:text-zinc-200";
    default:
      return "border-zinc-600/40 bg-zinc-100 text-zinc-800 dark:border-zinc-400/40 dark:bg-zinc-800 dark:text-zinc-200";
  }
}

export function LogViewer({ isOpen, onOpenChange }: Readonly<LogViewerProps>) {
  const [logs, setLogs] = useState<LogEntry[]>(() => getLogs());
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("error");

  useEffect(() => {
    startBackendLogBridge();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    setLogs(getLogs());
    const unsubscribe = subscribeToLogs((newLogs) => {
      setLogs([...newLogs]);
    });

    return unsubscribe;
  }, [isOpen]);

  const filteredLogs = logs
    .filter((log) => {
      if (filter !== "all" && log.source !== filter) return false;
      if (levelFilter !== "all" && log.level !== levelFilter) return false;
      return true;
    })
    .slice()
    .reverse();

  const handleClear = () => {
    clearLogStore();
    setLogs([]);
  };

  const exportLogs = () => {
    void exportLogsToFile().catch((err) => {
      logger.error("Failed to export logs:", err);
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        scrollableBody={false}
        className={cn(
          "flex w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0",
          "h-[min(90dvh,100%)] max-h-[90dvh] sm:h-auto sm:max-h-[85vh]"
        )}
      >
        <DialogHeader className="shrink-0 border-b px-4 pb-3 pt-5 pr-12 sm:px-6 sm:pt-6 sm:pb-4">
          <DialogTitle>Log Viewer</DialogTitle>
          <DialogDescription className="text-left text-balance">
            Frontend and backend logs captured on this device. Defaults to
            errors so conversion failures are easy to spot.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 space-y-3 border-b bg-muted/30 px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <FilterGroup
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "frontend", label: "Frontend" },
                { value: "backend", label: "Backend" },
              ]}
            />
            <FilterGroup
              value={levelFilter}
              onChange={setLevelFilter}
              options={[
                { value: "all", label: "All levels" },
                {
                  value: "error",
                  label: "Errors",
                  className: "text-red-700 dark:text-red-300",
                },
                {
                  value: "warn",
                  label: "Warnings",
                  className: "text-amber-800 dark:text-amber-300",
                },
                { value: "info", label: "Info" },
              ]}
            />
            <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={handleClear}
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={exportLogs}
              >
                Export
              </Button>
            </div>
          </div>

          <p className="text-xs text-foreground/70">
            Showing {filteredLogs.length} of {logs.length} · newest first
          </p>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-background [-webkit-overflow-scrolling:touch]">
          <div className="space-y-2 p-3 font-mono text-[13px] leading-snug sm:p-4">
            {filteredLogs.length === 0 ? (
              <div className="py-12 text-center font-sans text-sm text-foreground/70">
                No logs to display. Reproduce the issue, then open this viewer
                again (or switch to All levels).
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <article
                  key={`${log.timestamp}-${log.level}-${index}`}
                  className={cn(
                    "min-w-0 max-w-full overflow-hidden rounded-md border border-black/10 border-l-4 px-2.5 py-2 shadow-sm dark:border-white/15 sm:px-3",
                    levelStyles(log.level)
                  )}
                >
                  <header className="mb-1.5 flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <time
                      dateTime={log.timestamp}
                      className="font-sans text-[11px] font-medium tabular-nums text-current/70"
                    >
                      {formatTimestamp(log.timestamp)}
                    </time>
                    <Badge
                      variant="outline"
                      className="h-5 border-current/25 bg-white/60 px-1.5 font-sans text-[10px] uppercase tracking-wide text-current dark:bg-black/30"
                    >
                      {log.source}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 px-1.5 font-sans text-[10px] font-semibold uppercase tracking-wide",
                        levelBadgeStyles(log.level)
                      )}
                    >
                      {log.level}
                    </Badge>
                  </header>
                  <p className="min-w-0 whitespace-pre-wrap break-all text-[12px] font-medium sm:text-[13px]">
                    {log.message}
                  </p>
                  {log.data != null && (
                    <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded border border-black/10 bg-white/80 px-2 py-1.5 text-[11px] text-current dark:border-white/15 dark:bg-black/40">
                      {JSON.stringify(log.data, null, 2) || ""}
                    </pre>
                  )}
                </article>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilterGroup<T extends string>({
  value,
  onChange,
  options,
}: Readonly<{
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; className?: string }>;
}>) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? "default" : "outline"}
          size="sm"
          className={cn("h-7 shrink-0 text-xs", option.className)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
