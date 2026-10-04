import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HardDrive, RefreshCw, Trash2 } from "lucide-react";
import filesize from "filesize";

import type {
  StorageCleanupResult,
  StorageReport,
} from "../../types/storage";
import { useTranslation } from "../../lib/i18n";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";

export function StorageSection() {
  const { t } = useTranslation();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCleaning, setIsCleaning] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setReport(await invoke<StorageReport>("get_storage_report"));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("settings.storage.load_error")
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const removableIssueCount =
    report?.issues.filter((issue) => issue.removable).length ?? 0;

  const cleanupOrphans = async () => {
    setIsCleaning(true);
    setError(null);
    try {
      const result = await invoke<StorageCleanupResult>(
        "cleanup_orphaned_storage"
      );
      setCleanupMessage(
        t("settings.storage.cleanup_complete", {
          count: result.removedDirectories,
          bytes: filesize(result.removedBytes),
        })
      );
      setConfirmCleanup(false);
      await loadReport();
    } catch (cleanupError) {
      setError(
        cleanupError instanceof Error
          ? cleanupError.message
          : t("settings.storage.cleanup_error")
      );
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="size-5" />
              {t("settings.storage.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.storage.description")}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void loadReport()}
            disabled={isLoading || isCleaning}
            aria-label={t("settings.storage.scan")}
            title={t("settings.storage.scan")}
            data-testid="storage-refresh-button"
          >
            <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {cleanupMessage && (
          <p className="text-sm text-muted-foreground" role="status">
            {cleanupMessage}
          </p>
        )}
        {isLoading && !report ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.storage.loading")}
          </p>
        ) : report ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {t("settings.storage.total")}
                </p>
                <p className="text-xl font-semibold tabular-nums" data-testid="storage-total-size">
                  {filesize(report.totalBytes)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {t("settings.storage.database")}
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {filesize(report.databaseBytes)}
                </p>
              </div>
            </div>

            <section className="space-y-2" aria-labelledby="storage-books-title">
              <h3 id="storage-books-title" className="font-medium">
                {t("settings.storage.books")}
              </h3>
              {report.books.length ? (
                <ul className="divide-y rounded-md border">
                  {[...report.books]
                    .sort((left, right) => right.bytes - left.bytes)
                    .map((book) => (
                      <li
                        key={book.bookId}
                        className="flex min-w-0 items-center justify-between gap-4 px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-sm">
                          {book.title}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                          {filesize(book.bytes)}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("settings.storage.no_books")}
                </p>
              )}
            </section>

            <section className="space-y-2" aria-labelledby="storage-issues-title">
              <h3 id="storage-issues-title" className="font-medium">
                {t("settings.storage.issues")}
              </h3>
              {report.issues.length ? (
                <ul className="space-y-2">
                  {report.issues.map((issue, index) => (
                    <li
                      key={`${issue.kind}-${issue.bookId ?? issue.relativePath}-${index}`}
                      className="flex min-w-0 items-start justify-between gap-4 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {t(`settings.storage.issue.${issue.kind}`)}
                          {issue.title ? ` · ${issue.title}` : ""}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {issue.relativePath}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {issue.bytes > 0 ? filesize(issue.bytes) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="storage-no-issues">
                  {t("settings.storage.no_issues")}
                </p>
              )}
            </section>

            {removableIssueCount > 0 && !confirmCleanup && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmCleanup(true)}
                disabled={isCleaning}
                data-testid="storage-cleanup-button"
              >
                <Trash2 className="size-4" />
                {t("settings.storage.cleanup", { count: removableIssueCount })}
              </Button>
            )}
            {confirmCleanup && (
              <div className="space-y-3 rounded-md border border-destructive/40 p-3" role="group">
                <p className="text-sm">
                  {t("settings.storage.cleanup_confirmation", {
                    count: removableIssueCount,
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void cleanupOrphans()}
                    disabled={isCleaning}
                    data-testid="storage-confirm-cleanup-button"
                  >
                    <Trash2 className="size-4" />
                    {isCleaning
                      ? t("settings.storage.cleaning")
                      : t("settings.storage.cleanup_confirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmCleanup(false)}
                    disabled={isCleaning}
                  >
                    {t("settings.storage.cleanup_cancel")}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}