import { useEffect, useRef, useState } from "react";

import {
  clearLogs as clearLogStore,
  getLogs,
  startBackendLogBridge,
  subscribeToLogs,
  type LogEntry,
} from "../../lib/logger";
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

export function LogViewer({ isOpen, onOpenChange }: Readonly<LogViewerProps>) {
  const [logs, setLogs] = useState<LogEntry[]>(() => getLogs());
  const [filter, setFilter] = useState<"all" | "frontend" | "backend">("all");
  const [levelFilter, setLevelFilter] = useState<
    "all" | "log" | "info" | "warn" | "error" | "debug"
  >("error");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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

  useEffect(() => {
    if (autoScroll && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) => {
    if (filter !== "all" && log.source !== filter) return false;
    if (levelFilter !== "all" && log.level !== levelFilter) return false;
    return true;
  });

  const getLevelColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "error":
        return "bg-red-500/20 text-red-400 border-red-500/50";
      case "warn":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/50";
      case "info":
        return "bg-blue-500/20 text-blue-400 border-blue-500/50";
      case "debug":
        return "bg-gray-500/20 text-gray-400 border-gray-500/50";
      default:
        return "bg-gray-500/10 text-gray-300 border-gray-500/30";
    }
  };

  const handleClear = () => {
    clearLogStore();
    setLogs([]);
  };

  const exportLogs = () => {
    const logText = filteredLogs
      .map(
        (log) =>
          `[${log.timestamp}] [${log.source.toUpperCase()}] [${log.level.toUpperCase()}] ${log.message}${
            log.data ? ` ${JSON.stringify(log.data, null, 2)}` : ""
          }`
      )
      .join("\n");

    const blob = new Blob([logText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aurorabook-logs-${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Log Viewer</DialogTitle>
          <DialogDescription>
            Frontend and backend logs captured on this device. Defaults to
            errors so conversion failures are easy to spot.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 flex-wrap items-center mb-4">
          <div className="flex gap-2">
            <Button
              variant={filter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("all")}
            >
              All
            </Button>
            <Button
              variant={filter === "frontend" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("frontend")}
            >
              Frontend
            </Button>
            <Button
              variant={filter === "backend" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("backend")}
            >
              Backend
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              variant={levelFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setLevelFilter("all")}
            >
              All Levels
            </Button>
            <Button
              variant={levelFilter === "error" ? "default" : "outline"}
              size="sm"
              onClick={() => setLevelFilter("error")}
              className="text-red-400"
            >
              Errors
            </Button>
            <Button
              variant={levelFilter === "warn" ? "default" : "outline"}
              size="sm"
              onClick={() => setLevelFilter("warn")}
              className="text-yellow-400"
            >
              Warnings
            </Button>
            <Button
              variant={levelFilter === "info" ? "default" : "outline"}
              size="sm"
              onClick={() => setLevelFilter("info")}
            >
              Info
            </Button>
          </div>

          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={handleClear}>
              Clear
            </Button>
            <Button variant="outline" size="sm" onClick={exportLogs}>
              Export
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => {
                  setAutoScroll(e.target.checked);
                }}
                className="rounded"
              />
              Auto-scroll
            </label>
          </div>
        </div>

        <div className="text-sm text-muted-foreground mb-2">
          Showing {filteredLogs.length} of {logs.length} logs
        </div>

        <ScrollArea className="flex-1 min-h-[40vh] border rounded-md p-4 bg-black/50 font-mono text-sm">
          <div ref={scrollAreaRef} className="space-y-1">
            {filteredLogs.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">
                No logs to display. Reproduce the issue, then open this viewer
                again (or switch to All Levels).
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <div
                  key={`${log.timestamp}-${index}`}
                  className={`border-l-2 pl-3 py-1 rounded ${getLevelColor(log.level)}`}
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-xs opacity-70">{log.timestamp}</span>
                    <Badge variant="outline" className="text-xs">
                      {log.source}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {log.level}
                    </Badge>
                    <span className="flex-1 break-words">{log.message}</span>
                  </div>
                  {log.data != null && (
                    <pre className="mt-2 text-xs opacity-80 overflow-x-auto">
                      {JSON.stringify(log.data, null, 2) || ""}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
