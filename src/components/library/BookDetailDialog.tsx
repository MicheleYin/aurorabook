import { useCallback, useEffect, useState } from "react";
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

interface M4bExportProgress {
  bookId: string;
  currentStep: string;
  message: string;
  processedTracks: number;
  totalTracks: number;
  percent: number;
  etaMs: number | null;
}

interface M4bExportStatus {
  inProgress: boolean;
  bookId: string | null;
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
  eta,
}: {
  book: Book;
  conversionProgress: ConversionProgress | null;
  eta: string | null;
}) => {
  const { t } = useTranslation();
  
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
                      ) * 1000
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
  const [isExportingM4b, setIsExportingM4b] = useState(false);
  const [isCancellingM4b, setIsCancellingM4b] = useState(false);
  const [isAnyM4bExporting, setIsAnyM4bExporting] = useState(false);
  const [isPreConversionOpen, setIsPreConversionOpen] = useState(false);
  const [activeM4bExportBookId, setActiveM4bExportBookId] =
    useState<string | null>(null);
  const { settings } = useSettingsContext();
  const isMobile = useIsMobile();

  const syncM4bExportStatus = useCallback(async () => {
    try {
      const status = await invoke<M4bExportStatus>("get_m4b_export_status");
      setIsAnyM4bExporting(status.inProgress);
      setActiveM4bExportBookId(status.bookId);

      if (!book) {
        setIsExportingM4b(false);
        return;
      }

      setIsExportingM4b(status.inProgress && status.bookId === book.id);
    } catch (err) {
      logger.warn("Failed to sync M4B export status:", err);
    }
  }, [book]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void syncM4bExportStatus();

    const interval = window.setInterval(() => {
      void syncM4bExportStatus();
    }, 1500);

    return () => {
      window.clearInterval(interval);
    };
  }, [isOpen, syncM4bExportStatus]);

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

  const handleExportM4b = useCallback(async () => {
    if (!book) return;

    const toastId = `m4b-export-${book.id}`;
    let unlistenM4bProgress: (() => void) | null = null;

    try {
      const currentStatus = await invoke<M4bExportStatus>(
        "get_m4b_export_status"
      );

      if (currentStatus.inProgress) {
        setIsAnyM4bExporting(true);
        setActiveM4bExportBookId(currentStatus.bookId);
        setIsExportingM4b(currentStatus.bookId === book.id);

        toast.error(
          currentStatus.bookId === book.id
            ? "An M4B export is already running for this book"
            : "Another M4B export is already in progress"
        );
        return;
      }

      setIsExportingM4b(true);
      setIsAnyM4bExporting(true);
      setActiveM4bExportBookId(book.id);
      toast.loading("Starting M4B export...", { id: toastId });

      unlistenM4bProgress = await listen<M4bExportProgress>(
        "m4b-export-progress",
        (event) => {
          const progress = event.payload;

          setIsAnyM4bExporting(progress.currentStep !== "completed");
          setActiveM4bExportBookId(
            progress.currentStep === "completed" || progress.currentStep === "cancelled"
              ? null
              : progress.bookId
          );
          setIsExportingM4b(
            progress.bookId === book.id &&
              progress.currentStep !== "completed" &&
              progress.currentStep !== "cancelled"
          );

          if (progress.bookId !== book.id) {
            return;
          }

          if (progress.currentStep === "cancelled") {
            toast("M4B export cancelled", { id: toastId });
            return;
          }

          const etaText =
            progress.etaMs !== null
              ? ` ${t("status.eta", { time: humanizeDuration(progress.etaMs, { round: true, language: lang === "zh" ? "zh_CN" : lang }) })}`
              : "";

          const stepLabel = t(`conversion.step.${progress.currentStep.replace(/-/g, '_')}`);
          toast.loading(`${stepLabel} (${progress.percent}%)${etaText}`, {
            id: toastId,
          });
        }
      );

      // Open save dialog
      const filePath = await save({
        defaultPath: `${book.title}.m4b`,
        filters: [
          {
            name: "M4B Audio Files",
            extensions: ["m4b"],
          },
        ],
      });

      if (!filePath) {
        // User cancelled
        return;
      }

      // Call backend to export M4B
      await invoke("export_as_m4b", {
        bookId: book.id,
        outputPath: filePath,
      });

      toast.success("M4B exported successfully", { id: toastId });
    } catch (err) {
      logger.error("Failed to export M4B:", err);
      const message = err instanceof Error ? err.message : "Failed to export M4B";
      if (message.toLowerCase().includes("cancel")) {
        toast("M4B export cancelled", { id: toastId });
      } else {
        toast.error(message, {
          id: toastId,
        });
      }
    } finally {
      if (unlistenM4bProgress) {
        unlistenM4bProgress();
      }
      setIsExportingM4b(false);
      setIsCancellingM4b(false);
      void syncM4bExportStatus();
    }
  }, [book, syncM4bExportStatus]);

  const handleCancelM4bExport = useCallback(async () => {
    if (!isExportingM4b) {
      return;
    }

    try {
      setIsCancellingM4b(true);
      const cancelled = await invoke<boolean>("cancel_m4b_export");
      if (!cancelled) {
        toast("No M4B export is currently running");
      }
    } catch (err) {
      logger.error("Failed to cancel M4B export:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel M4B export"
      );
      setIsCancellingM4b(false);
    }
  }, [isExportingM4b]);

  const handleExportDropdownAction = useCallback(
    (value: string) => {
      if (value === "epub") {
        void handleExportEpub();
      } else if (value === "m4b") {
        void handleExportM4b();
      }
      setExportDropdownKey((prev) => prev + 1);
    },
    [handleExportEpub, handleExportM4b]
  );

  const handlePreConversionConfirm = (language: string, voiceId: string) => {
    onConvert(language, voiceId);
  };

  if (!book) return null;

  const isExportDisabled =
    isDeleting || isConvertingThisBook || isExportingM4b || isAnyM4bExporting;
  const isAnotherBookExporting =
    isAnyM4bExporting && activeM4bExportBookId !== null && activeM4bExportBookId !== book.id;

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
                  {isExportingM4b || isAnotherBookExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {isAnotherBookExporting
                          ? t("book.export_busy")
                          : t("book.exporting_m4b")}
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
                  <SelectItem value="m4b">{t("book.export_m4b")}</SelectItem>
                </SelectContent>
              </Select>
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
              {isExportingM4b && (
                <Button
                  variant="outline"
                  onClick={handleCancelM4bExport}
                  disabled={isDeleting || isCancellingM4b}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  {isCancellingM4b ? t("book.cancelling_export") : t("book.cancel_export")}
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
                  {isExportingM4b || isAnotherBookExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {isAnotherBookExporting
                          ? t("book.export_busy")
                          : t("book.exporting_m4b")}
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
                  <SelectItem className="w-full" value="epub">Export as EPUB</SelectItem>
                  <SelectItem className="w-full" value="m4b">Export as M4B</SelectItem>
                </SelectContent>
              </Select>
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
              {isExportingM4b && (
                <Button
                  variant="outline"
                  onClick={handleCancelM4bExport}
                  disabled={isDeleting || isCancellingM4b}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  {isCancellingM4b ? t("book.cancelling_export") : t("book.cancel_export")}
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
