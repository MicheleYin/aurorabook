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
      return "border-l-red-500 bg-red-500/10 text-red-100";
    case "warn":
      return "border-l-amber-500 bg-amber-500/10 text-amber-100";
    case "info":
      return "border-l-sky-500 bg-sky-500/10 text-sky-100";
    case "debug":
      return "border-l-zinc-500 bg-zinc-500/10 text-zinc-300";
    default:
      return "border-l-zinc-400 bg-zinc-500/5 text-zinc-200";
  }
}

function levelBadgeStyles(level: LogEntry["level"]): string {
  switch (level) {
    case "error":
      return "border-red-500/40 text-red-300";
    case "warn":
      return "border-amber-500/40 text-amber-300";
    case "info":
      return "border-sky-500/40 text-sky-300";
    case "debug":
      return "border-zinc-500/40 text-zinc-400";
    default:
      return "border-zinc-500/30 text-zinc-300";
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
                { value: "error", label: "Errors", className: "text-red-400" },
                { value: "warn", label: "Warnings", className: "text-amber-400" },
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

          <p className="text-xs text-muted-foreground">
            Showing {filteredLogs.length} of {logs.length} · newest first
          </p>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          <div className="space-y-2 p-3 font-mono text-[13px] leading-snug sm:p-4">
            {filteredLogs.length === 0 ? (
              <div className="py-12 text-center font-sans text-sm text-muted-foreground">
                No logs to display. Reproduce the issue, then open this viewer
                again (or switch to All levels).
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <article
                  key={`${log.timestamp}-${log.level}-${index}`}
                  className={cn(
                    "min-w-0 max-w-full overflow-hidden rounded-md border border-border/40 border-l-4 px-2.5 py-2 sm:px-3",
                    levelStyles(log.level)
                  )}
                >
                  <header className="mb-1.5 flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <time
                      dateTime={log.timestamp}
                      className="font-sans text-[11px] tabular-nums text-muted-foreground"
                    >
                      {formatTimestamp(log.timestamp)}
                    </time>
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 font-sans text-[10px] uppercase tracking-wide"
                    >
                      {log.source}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 px-1.5 font-sans text-[10px] uppercase tracking-wide",
                        levelBadgeStyles(log.level)
                      )}
                    >
                      {log.level}
                    </Badge>
                  </header>
                  <p className="min-w-0 whitespace-pre-wrap break-all text-[12px] sm:text-[13px]">
                    {log.message}
                  </p>
                  {log.data != null && (
                    <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 px-2 py-1.5 text-[11px] opacity-90">
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
