import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { useUnfinishedChapterDuration } from "../../hooks/useUnfinishedChapterDuration";
import {
  sumAudioTrackDurationSeconds,
  totalBookAudioDurationSeconds,
} from "../../lib/book-audio-duration";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../lib/i18n";
import { humanizeDurationLocale } from "../../constants/languages";
import {
  type AudioExportFormat,
  type AudioExportProgressPayload,
  type AudioExportStatusPayload,
  useAudioExportState,
} from "@/context/AudioExportStateContext";
import type { ConversionProgress } from "@/context/ConversionStateContext";
import { useConversionState } from "@/context/ConversionStateContext";
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

interface BookDetailDialogProps {
  book: Book | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConvert: (language?: string, voiceId?: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenBook: (book: Book) => void;
  isDeleting: boolean;
}

const BookDetailContent = ({
  book,
  conversionProgress,
  audioExportProgress,
  audioExportEtaMs,
  eta,
  unfinishedChapterDurationSeconds,
}: {
  book: Book;
  conversionProgress: ConversionProgress | null;
  audioExportProgress: AudioExportProgressPayload | null;
  audioExportEtaMs: number | null;
  eta: string | null;
  unfinishedChapterDurationSeconds: number;
}) => {
  const { t, lang } = useTranslation();
  const totalAudioDurationSeconds = useMemo(
    () =>
      totalBookAudioDurationSeconds(
        sumAudioTrackDurationSeconds(book.audioTracks),
        unfinishedChapterDurationSeconds
      ),
    [book.audioTracks, unfinishedChapterDurationSeconds]
  );
  const hasAudiobookInfo =
    (book.audioTracks?.length ?? 0) > 0 || totalAudioDurationSeconds > 0;
  const audioExportStepKey = audioExportProgress
    ? `conversion.step.${audioExportProgress.currentStep.replace(/-/g, "_")}`
    : "";
  const audioExportStepLabel = audioExportProgress
    ? t(audioExportStepKey)
    : "";

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
              {conversionProgress.message.trim().length > 0 && (
                <div className="text-xs text-muted-foreground leading-snug">
                  {conversionProgress.message}
                </div>
              )}
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
            <p className="text-sm font-medium mb-2">{t("book.export_progress")}</p>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {audioExportStepLabel === audioExportStepKey
                  ? audioExportProgress.message || audioExportProgress.currentStep
                  : audioExportStepLabel}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("book.export_track_count", {
                  current: audioExportProgress.processedTracks,
                  total: audioExportProgress.totalTracks,
                  format: audioExportProgress.format.toUpperCase(),
                })}
              </div>
              <Progress
                value={
                  audioExportProgress.percent > 0
                    ? audioExportProgress.percent
                    : audioExportProgress.totalTracks > 0
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
                  {audioExportProgress.percent > 0
                    ? audioExportProgress.percent
                    : audioExportProgress.totalTracks > 0
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

      {hasAudiobookInfo && (
        <>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">{t("book.audiobook")}</p>
            <div className="space-y-2">
              {book.audioTracks.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("audio.tracks")}
                  </span>
                  <span className="text-sm font-medium">
                    {book.audioTracks.length}
                  </span>
                </div>
              )}
              {totalAudioDurationSeconds > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("audio.total_duration")}
                  </span>
                  <span className="text-sm font-medium">
                    {humanizeDuration(
                      Math.round(totalAudioDurationSeconds) * 1000,
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
  isDeleting,
}: Readonly<BookDetailDialogProps>) {
  const { t } = useTranslation();
  const [exportDropdownKey, setExportDropdownKey] = useState(0);
  const [isPreConversionOpen, setIsPreConversionOpen] = useState(false);
  const { settings } = useSettingsContext();
  const isMobile = useIsMobile();

  const {
    convertingBookId,
    conversionProgress,
    eta,
    isConverting,
  } = useConversionState();

  const {
    isAnyExporting,
    activeExportBookId,
    activeExportFormat,
    exportProgress,
    derivedExportEtaMs,
    syncAudioExportStatus,
    cancelAudioExport,
    runAudioExport,
  } = useAudioExportState();

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void syncAudioExportStatus();
  }, [isOpen, syncAudioExportStatus]);

  const unfinishedChapterDurationSeconds = useUnfinishedChapterDuration(
    book,
    isOpen
  );
  const isConvertingThisBook = Boolean(
    book && convertingBookId === book.id
  );
  const bookConversionProgress =
    book && convertingBookId === book.id ? conversionProgress : null;
  const bookEta = book && convertingBookId === book.id ? eta : null;
  const bookExportProgress =
    book && exportProgress?.bookId === book.id ? exportProgress : null;
  const bookExportEtaMs =
    book && exportProgress?.bookId === book.id ? derivedExportEtaMs : null;

  const isExportingAudio = Boolean(
    book &&
      isAnyExporting &&
      activeExportBookId === book.id
  );
  const isAnotherBookExporting = Boolean(
    isAnyExporting &&
      activeExportBookId !== null &&
      book &&
      activeExportBookId !== book.id
  );

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

      toast.success(t("book.export_epub_success"));
    } catch (err) {
      logger.error("Failed to export EPUB:", err);
      toast.error(
        err instanceof Error ? err.message : t("book.export_epub_failed")
      );
    }
  }, [book, t]);

  const formatLabel = useCallback(
    (format: AudioExportFormat) => format.toUpperCase(),
    []
  );

  const handleExportAudio = useCallback(
    async (format: AudioExportFormat) => {
      if (!book) return;

      const toastId = `audio-export-${format}-${book.id}`;
      try {
        const exportStatus = await invoke<AudioExportStatusPayload>(
          "get_audio_export_status"
        );

        if (exportStatus.inProgress) {
          toast.error(
            exportStatus.bookId === book.id
              ? t("book.export_already_running_same")
              : t("book.export_already_running_other")
          );
          return;
        }

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

        await runAudioExport(book.id, format, filePath);

        toast.success(t("book.export_success", { format: formatLabel(format) }), {
          id: toastId,
        });
      } catch (err) {
        logger.error(`Failed to export ${formatLabel(format)}:`, err);
        const message =
          err instanceof Error
            ? err.message
            : t("book.export_failed", { format: formatLabel(format) });
        toast.error(message, { id: toastId });
      }
    },
    [book, runAudioExport, formatLabel, t]
  );

  const handleCancelAudioExport = useCallback(async () => {
    try {
      await cancelAudioExport();
    } catch (err) {
      logger.error("Failed to cancel audio export:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel audio export"
      );
    }
  }, [cancelAudioExport]);

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
    isAnyExporting;

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
                conversionProgress={bookConversionProgress}
                audioExportProgress={bookExportProgress}
                audioExportEtaMs={bookExportEtaMs}
                eta={bookEta}
                unfinishedChapterDurationSeconds={
                  unfinishedChapterDurationSeconds
                }
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
                          : t("book.exporting_format", {
                              format: formatLabel(activeExportFormat ?? "mp3"),
                            })}
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
                  <SelectItem value="m4a">{t("book.export_m4a")}</SelectItem>
                  <SelectItem value="m4b">{t("book.export_m4b")}</SelectItem>
                </SelectContent>
              </Select>
              {isExportingAudio && (
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => void handleCancelAudioExport()}
                    disabled={isDeleting}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    {t("book.cancel_export")}
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
                conversionProgress={bookConversionProgress}
                audioExportProgress={bookExportProgress}
                audioExportEtaMs={bookExportEtaMs}
                eta={bookEta}
                unfinishedChapterDurationSeconds={
                  unfinishedChapterDurationSeconds
                }
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
                          : t("book.exporting_format", {
                              format: formatLabel(activeExportFormat ?? "mp3"),
                            })}
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
                    {t("book.export_m4a")}
                  </SelectItem>
                  <SelectItem className="w-full" value="m4b">
                    {t("book.export_m4b")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {isExportingAudio && (
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => void handleCancelAudioExport()}
                    disabled={isDeleting}
                    className="gap-2 w-full"
                  >
                    <X className="h-4 w-4" />
                    {t("book.cancel_export")}
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
