/**
 * Audio export (MP3 / M4A / M4B) progress lives here so tab switches and dialog re-renders
 * do not drop listeners or state. A single Tauri event subscription is registered for the app lifetime.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { logger } from "../lib/logger";

export type AudioExportFormat = "mp3" | "m4a" | "m4b";

export interface AudioExportProgressPayload {
  bookId: string;
  format: string;
  currentStep: string;
  message: string;
  processedTracks: number;
  totalTracks: number;
  percent: number;
  etaMs: number | null;
}

export interface AudioExportStatusPayload {
  inProgress: boolean;
  bookId: string | null;
  format: string | null;
}

function normalizeFormat(f: string | null): AudioExportFormat | null {
  if (f === "mp3" || f === "m4a" || f === "m4b") {
    return f;
  }
  return null;
}

/** Linear ETA from tracks completed; `startedAtMs` is wall time when encode/export work began. */
function linearAudioExportEtaMs(
  startedAtMs: number,
  processedTracks: number,
  totalTracks: number
): number | null {
  if (totalTracks <= 0 || processedTracks <= 0) {
    return null;
  }
  if (processedTracks >= totalTracks) {
    return 0;
  }
  const elapsed = Math.max(1, Date.now() - startedAtMs);
  const rate = processedTracks / elapsed;
  if (!Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return (totalTracks - processedTracks) / rate;
}

interface AudioExportStateContextValue {
  /** True when the backend reports any audiobook file export in progress. */
  isAnyExporting: boolean;
  activeExportBookId: string | null;
  activeExportFormat: AudioExportFormat | null;
  /** Last payload for the active export (any book). */
  exportProgress: AudioExportProgressPayload | null;
  exportStartedAtMs: number | null;
  derivedExportEtaMs: number | null;
  syncAudioExportStatus: () => Promise<void>;
  cancelAudioExport: () => Promise<boolean>;
  /**
   * Runs the export command after the user has chosen `outputPath`.
   * Throws if another export is already running or the invoke fails.
   */
  runAudioExport: (
    bookId: string,
    format: AudioExportFormat,
    outputPath: string
  ) => Promise<void>;
  /** Clears optimistic UI if the user aborts before `runAudioExport` completes. */
  resetExportUi: () => void;
}

const AudioExportStateContext = createContext<AudioExportStateContextValue | null>(
  null
);

export function useAudioExportState() {
  const ctx = useContext(AudioExportStateContext);
  if (!ctx) {
    throw new Error(
      "useAudioExportState must be used within an AudioExportStateProvider"
    );
  }
  return ctx;
}

interface AudioExportStateProviderProps {
  children: ReactNode;
}

export function AudioExportStateProvider({
  children,
}: Readonly<AudioExportStateProviderProps>) {
  const [isAnyExporting, setIsAnyExporting] = useState(false);
  const [activeExportBookId, setActiveExportBookId] = useState<string | null>(
    null
  );
  const [activeExportFormat, setActiveExportFormat] =
    useState<AudioExportFormat | null>(null);
  const [exportProgress, setExportProgress] =
    useState<AudioExportProgressPayload | null>(null);
  const [exportStartedAtMs, setExportStartedAtMs] = useState<number | null>(
    null
  );
  const [exportEtaTick, setExportEtaTick] = useState(0);

  const isTerminalStep = useCallback((step: string) => {
    return step === "completed" || step === "cancelled";
  }, []);

  const applyProgressPayload = useCallback(
    (progress: AudioExportProgressPayload) => {
      const terminal = isTerminalStep(progress.currentStep);
      setIsAnyExporting(!terminal);
      setActiveExportBookId(terminal ? null : progress.bookId);
      setActiveExportFormat(
        terminal ? null : normalizeFormat(progress.format)
      );
      setExportProgress(terminal ? null : progress);
      if (terminal) {
        setExportStartedAtMs(null);
      }
    },
    [isTerminalStep]
  );

  const syncAudioExportStatus = useCallback(async () => {
    try {
      const exportStatus = await invoke<AudioExportStatusPayload>(
        "get_audio_export_status"
      );
      setIsAnyExporting(exportStatus.inProgress);
      setActiveExportBookId(exportStatus.bookId);
      setActiveExportFormat(normalizeFormat(exportStatus.format));
      if (!exportStatus.inProgress) {
        setExportProgress(null);
        setExportStartedAtMs(null);
      }
    } catch (err) {
      logger.warn("Failed to sync audio export status:", err);
    }
  }, []);

  const resetExportUi = useCallback(() => {
    setExportProgress(null);
    setExportStartedAtMs(null);
    void syncAudioExportStatus();
  }, [syncAudioExportStatus]);

  // Single app-wide listener for export progress (survives tab / dialog remounts).
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<AudioExportProgressPayload>(
      "audio-export-progress",
      (event) => {
        applyProgressPayload(event.payload);
      }
    ).then((fn) => {
      unlisten = fn;
    });

    void syncAudioExportStatus();

    return () => {
      unlisten?.();
    };
  }, [applyProgressPayload, syncAudioExportStatus]);

  // Poll while backend says export is running (covers missed events / remount race).
  useEffect(() => {
    if (!isAnyExporting) {
      return;
    }
    const id = window.setInterval(() => {
      void syncAudioExportStatus();
    }, 2000);
    return () => window.clearInterval(id);
  }, [isAnyExporting, syncAudioExportStatus]);

  useEffect(() => {
    if (!isAnyExporting || exportStartedAtMs === null || !exportProgress) {
      return;
    }
    const id = window.setInterval(() => {
      setExportEtaTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isAnyExporting, exportProgress, exportStartedAtMs]);

  const derivedExportEtaMs = useMemo(() => {
    if (
      exportStartedAtMs === null ||
      exportProgress === null ||
      isTerminalStep(exportProgress.currentStep)
    ) {
      return null;
    }
    void exportEtaTick;
    return linearAudioExportEtaMs(
      exportStartedAtMs,
      exportProgress.processedTracks,
      exportProgress.totalTracks
    );
  }, [
    exportEtaTick,
    exportProgress,
    exportStartedAtMs,
    isTerminalStep,
  ]);

  const cancelAudioExport = useCallback(async () => {
    try {
      return await invoke<boolean>("cancel_audio_export");
    } catch (err) {
      logger.error("Failed to cancel audio export:", err);
      throw err;
    }
  }, []);

  const runAudioExport = useCallback(
    async (bookId: string, format: AudioExportFormat, outputPath: string) => {
      const exportStatus = await invoke<AudioExportStatusPayload>(
        "get_audio_export_status"
      );
      if (exportStatus.inProgress) {
        const busySameBook = exportStatus.bookId === bookId;
        throw new Error(
          busySameBook
            ? "An export is already running for this book"
            : "Another export is already in progress"
        );
      }

      setIsAnyExporting(true);
      setActiveExportBookId(bookId);
      setActiveExportFormat(format);
      setExportStartedAtMs(Date.now());
      setExportEtaTick(0);
      setExportProgress({
        bookId,
        format,
        currentStep: "initializing",
        message: "",
        processedTracks: 0,
        totalTracks: 0,
        percent: 0,
        etaMs: null,
      });

      const commandName =
        format === "m4a"
          ? "export_as_m4a"
          : format === "m4b"
            ? "export_as_m4b"
            : "export_as_mp3";

      const exportTimeoutMs = 7_200_000;
      try {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            reject(
              new Error(
                `${format.toUpperCase()} export timed out. Please try again.`
              )
            );
          }, exportTimeoutMs);

          invoke(commandName, {
            bookId,
            outputPath,
          })
            .then(() => {
              window.clearTimeout(timeoutId);
              resolve();
            })
            .catch((err: unknown) => {
              window.clearTimeout(timeoutId);
              reject(err);
            });
        });
      } catch (err) {
        setIsAnyExporting(false);
        setActiveExportBookId(null);
        setActiveExportFormat(null);
        setExportProgress(null);
        setExportStartedAtMs(null);
        void syncAudioExportStatus();
        if (err instanceof Error) {
          throw err;
        }
        throw new Error(String(err));
      }

      void syncAudioExportStatus();
    },
    [syncAudioExportStatus]
  );

  const value = useMemo<AudioExportStateContextValue>(
    () => ({
      isAnyExporting,
      activeExportBookId,
      activeExportFormat,
      exportProgress,
      exportStartedAtMs,
      derivedExportEtaMs,
      syncAudioExportStatus,
      cancelAudioExport,
      runAudioExport,
      resetExportUi,
    }),
    [
      isAnyExporting,
      activeExportBookId,
      activeExportFormat,
      exportProgress,
      exportStartedAtMs,
      derivedExportEtaMs,
      syncAudioExportStatus,
      cancelAudioExport,
      runAudioExport,
      resetExportUi,
    ]
  );

  return (
    <AudioExportStateContext.Provider value={value}>
      {children}
    </AudioExportStateContext.Provider>
  );
}
