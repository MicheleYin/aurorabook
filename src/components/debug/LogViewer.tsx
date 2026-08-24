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
import { ScrollArea } from "../ui/scroll-area";

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
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>Log Viewer</DialogTitle>
          <DialogDescription>
            Frontend and backend logs captured on this device. Defaults to
            errors so conversion failures are easy to spot.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b space-y-3 shrink-0 bg-muted/30">
          <div className="flex gap-2 flex-wrap items-center">
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
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={handleClear}>
                Clear
              </Button>
              <Button variant="outline" size="sm" onClick={exportLogs}>
                Export
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Showing {filteredLogs.length} of {logs.length} · newest first
          </p>
        </div>

        <ScrollArea className="flex-1 min-h-[45vh] max-h-[55vh]">
          <div className="p-4 space-y-2 font-mono text-[13px] leading-snug">
            {filteredLogs.length === 0 ? (
              <div className="text-muted-foreground text-center py-12 text-sm font-sans">
                No logs to display. Reproduce the issue, then open this viewer
                again (or switch to All levels).
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <article
                  key={`${log.timestamp}-${log.level}-${index}`}
                  className={cn(
                    "rounded-md border border-border/40 border-l-4 px-3 py-2",
                    levelStyles(log.level)
                  )}
                >
                  <header className="flex items-center gap-2 flex-wrap mb-1.5">
                    <time
                      dateTime={log.timestamp}
                      className="text-[11px] tabular-nums text-muted-foreground font-sans"
                    >
                      {formatTimestamp(log.timestamp)}
                    </time>
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 px-1.5 font-sans uppercase tracking-wide"
                    >
                      {log.source}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] h-5 px-1.5 font-sans uppercase tracking-wide",
                        levelBadgeStyles(log.level)
                      )}
                    >
                      {log.level}
                    </Badge>
                  </header>
                  <p className="whitespace-pre-wrap break-words text-[13px]">
                    {log.message}
                  </p>
                  {log.data != null && (
                    <pre className="mt-2 rounded bg-black/40 px-2 py-1.5 text-[11px] opacity-90 overflow-x-auto">
                      {JSON.stringify(log.data, null, 2) || ""}
                    </pre>
                  )}
                </article>
              ))
            )}
          </div>
        </ScrollArea>
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
    <div className="flex gap-1.5 flex-wrap">
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? "default" : "outline"}
          size="sm"
          className={cn("h-7 text-xs", option.className)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
