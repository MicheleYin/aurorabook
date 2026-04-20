import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { filesize } from "filesize";
import humanizeDuration from "humanize-duration";
import {
  BookOpen,
  Calendar,
  Download,
  FileText,
  Loader2,
  Play,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import type { Book } from "../../types/book";
import { useIsMobile } from "../../hooks/useIsMobile";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../lib/i18n";
import { humanizeDurationLocale } from "../../constants/languages";
import { useSettingsContext } from "@/context/SettingsContext";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Progress } from "../ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import { PreConversionDialog } from "./PreConversionDialog";

interface ConversionProgress {
  currentChapter: number;
  totalChapters: number;
  wordsProcessed: number;
  totalWords: number;
  wordsInCurrentChapter: number;
  currentStep: string;
  message: string;
}

type AudioExportFormat = "mp3" | "m4a" | "m4b";

interface AudioExportProgress {
  bookId: string;
  format: AudioExportFormat;
  currentStep: string;
  message: string;
  processedTracks: number;
  totalTracks: number;
  percent: number;
  etaMs: number | null;
}

interface AudioExportStatus {
  inProgress: boolean;
  bookId: string | null;
  format: AudioExportFormat | null;
}

/** Linear ETA from tracks completed; `startedAtMs` should be wall time when export work began. */
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

interface BookDetailDialogProps {
  book: Book | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConvert: (language?: string, voiceId?: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenBook: (book: Book) => void;
  isConverting: boolean;
  isConvertingThisBook: boolean;
  isDeleting: boolean;
  conversionProgress: ConversionProgress | null;
  eta: string | null;
}

const BookDetailContent = ({
  book,
  conversionProgress,
  audioExportProgress,
  audioExportEtaMs,
  eta,
}: {
  book: Book;
  conversionProgress: ConversionProgress | null;
  audioExportProgress: AudioExportProgress | null;
  audioExportEtaMs: number | null;
  eta: string | null;
}) => {
  const { t, lang } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex gap-6">
        <div className="w-32 h-48 bg-muted rounded overflow-hidden shrink-0">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <BookOpen className="h-12 w-12 text-muted-foreground/50" />
            </div>
          )}
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{t("book.author")}</span>
            </div>
            <p className="text-sm text-muted-foreground">{book.author}</p>
          </div>
          {book.publisher && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{t("book.publisher")}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {book.publisher}
                {book.publishedYear && `, ${book.publishedYear}`}
              </p>
            </div>
          )}
          {book.publishedYear && !book.publisher && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{t("book.published")}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {book.publishedYear}
              </p>
            </div>
          )}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm font-medium mb-1">{t("book.chapters")}</p>
          <p className="text-sm text-muted-foreground">
            {book.chapters.length}
          </p>
        </div>
        {book.pageCount && (
          <div>
            <p className="text-sm font-medium mb-1">{t("book.pages")}</p>
            <p className="text-sm text-muted-foreground">{book.pageCount}</p>
          </div>
        )}
        {book.fileSizeBytes && (
          <div>
            <p className="text-sm font-medium mb-1">{t("book.file_size")}</p>
            <p className="text-sm text-muted-foreground">
              {filesize(book.fileSizeBytes)}
            </p>
          </div>
        )}
        {!!book.progress?.bookProgressPercent && (
          <div>
            <p className="text-sm font-medium mb-1">{t("book.progress")}</p>
            <p className="text-sm text-muted-foreground">
              {Math.round(book.progress.bookProgressPercent)}%
            </p>
          </div>
        )}
      </div>

      {book.subjects && book.subjects.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">{t("book.subjects")}</p>
            <div className="flex flex-wrap gap-2">
              {book.subjects.map((subject) => (
                <Badge key={subject} variant="secondary">
                  {subject}
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}

      {!!book.progress?.bookProgressPercent && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">{t("book.reading_progress")}</p>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${book.progress.bookProgressPercent}%` }}
              />
            </div>
          </div>
        </>
      )}

      {book.conversionStatus && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">{t("book.conversion_status")}</p>
            <Badge
              variant={
                book.conversionStatus === "done"
                  ? "default"
                  : book.conversionStatus === "started"
                    ? "secondary"
                    : "outline"
              }
            >
              {t(`status.${book.conversionStatus}`)}
            </Badge>
          </div>
        </>
      )}

      {conversionProgress && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">{t("book.conversion_progress")}</p>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {t(`conversion.step.${conversionProgress.currentStep.replace(/-/g, '_')}`)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("book.chapter_count", { current: conversionProgress.currentChapter, total: conversionProgress.totalChapters })}
              </div>
              <Progress
                value={
                  conversionProgress.totalWords > 0
                    ? Math.round(
                        (conversionProgress.wordsProcessed /
                          conversionProgress.totalWords) *
                          100
                      )
                    : 0
                }
                className="h-2"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {conversionProgress.totalWords > 0
                    ? Math.round(
                        (conversionProgress.wordsProcessed /
                          conversionProgress.totalWords) *
                          100
                      )
                    : 0}
                  %
                </span>
                {eta && (
                  <span className="text-xs text-muted-foreground">
                    {t("status.eta", { time: eta })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {audioExportProgress && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Export Progress</p>
            <div className="space-y-2">
              {/*
                Keep export progress high-level: tracks processed vs total.
                Avoid noisy per-step updates (e.g. "encoding track ...").
              */}
              <div className="text-sm text-muted-foreground">
                Processing tracks...
              </div>
              <div className="text-xs text-muted-foreground">
                {audioExportProgress.processedTracks}/{audioExportProgress.totalTracks}{" "}
                tracks ({audioExportProgress.format.toUpperCase()})
              </div>
              <Progress
                value={
                  audioExportProgress.totalTracks > 0
                    ? Math.round(
                        (audioExportProgress.processedTracks /
                          audioExportProgress.totalTracks) *
                          100
                      )
                    : 0
                }
                className="h-2"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {audioExportProgress.totalTracks > 0
                    ? Math.round(
                        (audioExportProgress.processedTracks /
                          audioExportProgress.totalTracks) *
                          100
                      )
                    : 0}
                  %
                </span>
                {audioExportEtaMs !== null && (
                  <span className="text-xs text-muted-foreground">
                    {t("status.eta", {
                      time: humanizeDuration(audioExportEtaMs, {
                        round: true,
                        language: humanizeDurationLocale(lang),
                      }),
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {book.audioTracks && book.audioTracks.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">{t("book.audiobook")}</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t("audio.tracks")}
                </span>
                <span className="text-sm font-medium">
                  {book.audioTracks.length}
                </span>
              </div>
              {book.audioTracks.some((track) => track.duration) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("audio.total_duration")}
                  </span>
                  <span className="text-sm font-medium">
                    {humanizeDuration(
                      book.audioTracks.reduce(
                        (total, track) => total + (track.duration || 0),
                        0
                      ) * 1000,
                      { language: humanizeDurationLocale(lang) }
                    )}
                  </span>
                </div>
              )}

              {book.audioTracks.some((track) => track.fileSizeBytes) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("audio.size")}
                  </span>
                  <span className="text-sm font-medium">
                    {filesize(
                      book.audioTracks.reduce(
                        (total, track) => total + (track.fileSizeBytes || 0),
                        0
                      )
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export function BookDetailDialog({
  book,
  isOpen,
  onOpenChange,
  onConvert,
  onCancel,
  onDelete,
  onOpenBook,
  isConverting,
  isConvertingThisBook,
  isDeleting,
  conversionProgress,
  eta,
}: Readonly<BookDetailDialogProps>) {
  const { t, lang } = useTranslation();
  const [exportDropdownKey, setExportDropdownKey] = useState(0);
  const [isExportingAudio, setIsExportingAudio] = useState(false);
  const [isAnyAudioExporting, setIsAnyAudioExporting] = useState(false);
  const [activeAudioExportBookId, setActiveAudioExportBookId] =
    useState<string | null>(null);
  const [activeAudioExportFormat, setActiveAudioExportFormat] =
    useState<AudioExportFormat | null>(null);
  const [audioExportProgress, setAudioExportProgress] =
    useState<AudioExportProgress | null>(null);
  const [audioExportStartedAtMs, setAudioExportStartedAtMs] = useState<
    number | null
  >(null);
  const [audioExportEtaTick, setAudioExportEtaTick] = useState(0);
  const [isPreConversionOpen, setIsPreConversionOpen] = useState(false);
  const { settings } = useSettingsContext();
  const isMobile = useIsMobile();

  const syncAudioExportStatus = useCallback(async () => {
    try {
      const exportStatus = await invoke<AudioExportStatus>(
        "get_audio_export_status"
      );
      setIsAnyAudioExporting(exportStatus.inProgress);
      setActiveAudioExportBookId(exportStatus.bookId);
      setActiveAudioExportFormat(exportStatus.format);

      if (!book) {
        setIsExportingAudio(false);
        setAudioExportProgress(null);
        setAudioExportStartedAtMs(null);
        return;
      }

      if (exportStatus.inProgress && exportStatus.bookId === book.id) {
        setIsExportingAudio(true);
      }
    } catch (err) {
      logger.warn("Failed to sync audio export status:", err);
    }
  }, [book]);

  const audioExportEtaMs = useMemo(() => {
    if (
      audioExportStartedAtMs === null ||
      audioExportProgress === null
    ) {
      return null;
    }
    void audioExportEtaTick;
    return linearAudioExportEtaMs(
      audioExportStartedAtMs,
      audioExportProgress.processedTracks,
      audioExportProgress.totalTracks
    );
  }, [audioExportEtaTick, audioExportProgress, audioExportStartedAtMs]);

  useEffect(() => {
    if (audioExportStartedAtMs === null || audioExportProgress === null) {
      return;
    }
    const id = window.setInterval(() => {
      setAudioExportEtaTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [audioExportProgress, audioExportStartedAtMs]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void syncAudioExportStatus();

    const interval = window.setInterval(() => {
      void syncAudioExportStatus();
    }, 1500);

    return () => {
      window.clearInterval(interval);
    };
  }, [isOpen, syncAudioExportStatus]);

  const handleDeleteClick = useCallback(() => onDelete(), [onDelete]);

  const handleExportEpub = useCallback(async () => {
    if (!book) return;

    try {
      // Open save dialog
      const filePath = await save({
        defaultPath: `${book.title}.epub`,
        filters: [
          {
            name: "EPUB Files",
            extensions: ["epub"],
          },
        ],
      });

      if (!filePath) {
        // User cancelled
        return;
      }

      // Call backend to export EPUB
      await invoke("export_epub_to_file", {
        bookId: book.id,
        outputPath: filePath,
      });

      toast.success("EPUB exported successfully");
    } catch (err) {
      logger.error("Failed to export EPUB:", err);
      toast.error(err instanceof Error ? err.message : "Failed to export EPUB");
    }
  }, [book]);

  const formatLabel = useCallback(
    (format: AudioExportFormat) => format.toUpperCase(),
    []
  );

  const handleExportAudio = useCallback(async (format: AudioExportFormat) => {
    if (!book) return;

    const toastId = `audio-export-${format}-${book.id}`;
    let unlistenProgress: (() => void) | null = null;

    try {
      const exportStatus = await invoke<AudioExportStatus>(
        "get_audio_export_status"
      );

      if (exportStatus.inProgress) {
        setIsAnyAudioExporting(true);
        setActiveAudioExportBookId(exportStatus.bookId);
        setActiveAudioExportFormat(exportStatus.format);
        setIsExportingAudio(
          exportStatus.inProgress && exportStatus.bookId === book.id
        );

        toast.error(
          exportStatus.bookId === book.id
            ? "An export is already running for this book"
            : "Another export is already in progress"
        );
        return;
      }

      setIsExportingAudio(true);
      setIsAnyAudioExporting(true);
      setActiveAudioExportBookId(book.id);
      setActiveAudioExportFormat(format);
      setAudioExportStartedAtMs(null);
      setAudioExportEtaTick(0);
      setAudioExportProgress({
        bookId: book.id,
        format,
        currentStep: "initializing",
        message: `Starting ${formatLabel(format)} export...`,
        processedTracks: 0,
        totalTracks: 0,
        percent: 0,
        etaMs: null,
      });

      unlistenProgress = await listen<AudioExportProgress>(
        "audio-export-progress",
        (event) => {
          const progress = event.payload;

          setIsAnyAudioExporting(progress.currentStep !== "completed");
          setActiveAudioExportBookId(
            progress.currentStep === "completed" ||
              progress.currentStep === "cancelled"
              ? null
              : progress.bookId
          );
          setActiveAudioExportFormat(
            progress.currentStep === "completed" ||
              progress.currentStep === "cancelled"
              ? null
              : progress.format
          );
          setIsExportingAudio(
            progress.bookId === book.id &&
              progress.currentStep !== "completed" &&
              progress.currentStep !== "cancelled"
          );
          setAudioExportProgress(
            progress.bookId === book.id &&
              progress.currentStep !== "completed" &&
              progress.currentStep !== "cancelled"
              ? progress
              : null
          );

          if (progress.bookId !== book.id) {
            return;
          }
        }
      );

      const extension = format;
      const filePath = await save({
        defaultPath: `${book.title}.${extension}`,
        filters: [
          {
            name: `${formatLabel(format)} Audio`,
            extensions: [extension],
          },
        ],
      });

      if (!filePath) {
        return;
      }

      setAudioExportStartedAtMs(Date.now());

      const commandName =
        format === "m4a"
          ? "export_as_m4a"
          : format === "m4b"
            ? "export_as_m4b"
            : "export_as_mp3";

      // Full-book re-encode can take a long time; a short timeout clears UI while Rust keeps running.
      const exportTimeoutMs = 7_200_000;
      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          reject(
            new Error(
              `${formatLabel(format)} export timed out. Please try again.`
            )
          );
        }, exportTimeoutMs);

        invoke(commandName, {
          bookId: book.id,
          outputPath: filePath,
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

      toast.success(`${formatLabel(format)} exported successfully`, {
        id: toastId,
      });
    } catch (err) {
      logger.error(`Failed to export ${formatLabel(format)}:`, err);
      const message =
        err instanceof Error
          ? err.message
          : `Failed to export ${formatLabel(format)}`;
      toast.error(message, { id: toastId });
    } finally {
      if (unlistenProgress) {
        unlistenProgress();
      }
      // Clear local UI state first; polling sync will re-assert if needed.
      setIsExportingAudio(false);
      setIsAnyAudioExporting(false);
      setActiveAudioExportBookId(null);
      setActiveAudioExportFormat(null);
      setAudioExportProgress(null);
      setAudioExportStartedAtMs(null);
      void syncAudioExportStatus();
    }
  }, [book, syncAudioExportStatus, formatLabel]);

  const handleCancelAudioExport = useCallback(async () => {
    if (!book) return;
    try {
      await invoke<boolean>("cancel_audio_export");
    } catch (err) {
      logger.error("Failed to cancel audio export:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel audio export"
      );
    }
  }, [book]);

  const handleExportDropdownAction = useCallback(
    (value: string) => {
      if (value === "epub") {
        void handleExportEpub();
      } else if (value === "mp3") {
        void handleExportAudio("mp3");
      } else if (value === "m4a") {
        void handleExportAudio("m4a");
      } else if (value === "m4b") {
        void handleExportAudio("m4b");
      }
      setExportDropdownKey((prev) => prev + 1);
    },
    [handleExportEpub, handleExportAudio]
  );

  const handlePreConversionConfirm = (language: string, voiceId: string) => {
    onConvert(language, voiceId);
  };

  if (!book) return null;

  const isExportDisabled =
    isDeleting ||
    isConvertingThisBook ||
    isExportingAudio ||
    isAnyAudioExporting;
  const isAnotherBookExporting =
    isAnyAudioExporting &&
    activeAudioExportBookId !== null &&
    activeAudioExportBookId !== book.id;

  return (
    <>
      {/* Desktop Dialog */}
      {!isMobile && (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
            <DialogHeader>
              <DialogTitle>{book.title}</DialogTitle>
              <DialogDescription>{t("book.details")}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto">
              <BookDetailContent
                book={book}
                conversionProgress={conversionProgress}
                audioExportProgress={audioExportProgress}
                audioExportEtaMs={audioExportEtaMs}
                eta={eta}
              />
            </div>
            <DialogFooter className="flex-shrink-0 gap-2">
              <Button
                onClick={() => {
                  onOpenBook(book);
                  onOpenChange(false);
                }}
                className="gap-2"
              >
                <BookOpen className="h-4 w-4" />
                {t("book.open")}
              </Button>
              <Select
                key={`desktop-${exportDropdownKey}`}
                onValueChange={handleExportDropdownAction}
                disabled={isExportDisabled}
              >
                <SelectTrigger className="w-[170px] gap-2">
                  {isExportingAudio || isAnotherBookExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {isAnotherBookExporting
                          ? t("book.export_busy")
                          : `Exporting ${formatLabel(activeAudioExportFormat ?? "mp3")}...`}
                      </span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <SelectValue placeholder={t("book.export")} />
                    </>
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="epub">{t("book.export_epub")}</SelectItem>
                  <SelectItem value="mp3">{t("book.export_mp3")}</SelectItem>
                  <SelectItem value="m4a">Export M4A</SelectItem>
                  <SelectItem value="m4b">Export M4B</SelectItem>
                </SelectContent>
              </Select>
              {isExportingAudio &&
                (activeAudioExportFormat === "m4a" ||
                  activeAudioExportFormat === "m4b") && (
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => void handleCancelAudioExport()}
                    disabled={isDeleting}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Cancel export
                  </Button>
                )}
              {book.conversionStatus === "started" && isConvertingThisBook && (
                <Button
                  variant="outline"
                  onClick={onCancel}
                  disabled={isDeleting}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  {t("book.cancel")}
                </Button>
              )}
              {book.conversionStatus === "started" && !isConvertingThisBook && (
                <Button
                  variant="outline"
                  onClick={() => setIsPreConversionOpen(true)}
                  disabled={isDeleting || isConverting}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  {t("book.resume")}
                </Button>
              )}
              {book.conversionStatus === "notStarted" && (
                <Button
                  variant="outline"
                  onClick={() => setIsPreConversionOpen(true)}
                  className="gap-2"
                  disabled={isDeleting || isConverting}
                >
                  <Play className="h-4 w-4" />
                  {t("book.convert")}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={handleDeleteClick}
                disabled={isDeleting || isConvertingThisBook}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? t("common.deleting") : t("book.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer open={isOpen} onOpenChange={onOpenChange}>
          <DrawerContent className="max-h-[80vh] flex flex-col">
            <DrawerHandle />
            <DrawerHeader>
              <DrawerTitle>{book.title}</DrawerTitle>
              <DrawerDescription>{t("book.details")}</DrawerDescription>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <BookDetailContent
                book={book}
                conversionProgress={conversionProgress}
                audioExportProgress={audioExportProgress}
                audioExportEtaMs={audioExportEtaMs}
                eta={eta}
              />
            </div>
            <DrawerFooter className="flex-shrink-0 gap-2 p-4">
              <Button
                onClick={() => {
                  onOpenBook(book);
                  onOpenChange(false);
                }}
                className="gap-2"
              >
                <BookOpen className="h-4 w-4" />
                {t("book.open")}
              </Button>
              <Select
                key={`mobile-${exportDropdownKey}`}
                onValueChange={handleExportDropdownAction}
                disabled={isExportDisabled}
              >
                <SelectTrigger className="w-full gap-2">
                  {isExportingAudio || isAnotherBookExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {isAnotherBookExporting
                          ? t("book.export_busy")
                          : `Exporting ${formatLabel(activeAudioExportFormat ?? "mp3")}...`}
                      </span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <SelectValue placeholder={t("book.export")} />
                    </>
                  )}
                </SelectTrigger>
                <SelectContent className="w-full">
                  <SelectItem className="w-full" value="epub">
                    {t("book.export_epub")}
                  </SelectItem>
                  <SelectItem className="w-full" value="mp3">
                    {t("book.export_mp3")}
                  </SelectItem>
                  <SelectItem className="w-full" value="m4a">
                    Export as M4A
                  </SelectItem>
                  <SelectItem className="w-full" value="m4b">
                    Export as M4B
                  </SelectItem>
                </SelectContent>
              </Select>
              {isExportingAudio &&
                (activeAudioExportFormat === "m4a" ||
                  activeAudioExportFormat === "m4b") && (
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => void handleCancelAudioExport()}
                    disabled={isDeleting}
                    className="gap-2 w-full"
                  >
                    <X className="h-4 w-4" />
                    Cancel export
                  </Button>
                )}
              {book.conversionStatus === "started" && isConvertingThisBook && (
                <Button
                  variant="outline"
                  onClick={onCancel}
                  disabled={isDeleting}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  {t("book.cancel")}
                </Button>
              )}
              {book.conversionStatus === "started" && !isConvertingThisBook && (
                <Button
                  variant="outline"
                  onClick={() => setIsPreConversionOpen(true)}
                  disabled={isDeleting || isConverting}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  {t("book.resume")}
                </Button>
              )}
              {book.conversionStatus === "notStarted" && (
                <Button
                  variant="outline"
                  onClick={() => setIsPreConversionOpen(true)}
                  className="gap-2"
                  disabled={isDeleting || isConverting}
                >
                  <Play className="h-4 w-4" />
                  {t("book.convert")}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={handleDeleteClick}
                disabled={isDeleting || isConvertingThisBook}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {isDeleting ? t("common.deleting") : t("book.delete")}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}

      {/* Pre-conversion Config Modal */}
      <PreConversionDialog
        isOpen={isPreConversionOpen}
        onOpenChange={setIsPreConversionOpen}
        onConfirm={handlePreConversionConfirm}
        defaultLanguage={settings?.ttsLanguage}
        defaultVoiceId={settings?.ttsVoiceId}
      />
    </>
  );
}
