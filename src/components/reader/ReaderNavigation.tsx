import { ChevronLeft, ChevronRight } from "lucide-react";

import type { Book, Chapter } from "../../types/book";
import { useTranslation } from "../../lib/i18n";
import { Button } from "../ui/button";

interface ReaderNavigationProps {
  book: Book;
  currentChapter: Chapter;
  onPrevious: () => void;
  onNext: () => void;
}

export function ReaderNavigation({
  book,
  currentChapter,
  onPrevious,
  onNext,
}: Readonly<ReaderNavigationProps>) {
  const { t } = useTranslation();
  const currentChapterIndex = book.chapters.findIndex(
    (ch) => ch.id === currentChapter.id
  );
  const hasPrevious = currentChapterIndex > 0;
  const hasNext = currentChapterIndex < book.chapters.length - 1;

  return (
    <div className="absolute left-0 right-0 z-10 flex-shrink-0 bottom-0 select-none safe-area-bottom">
      <div className="flex items-center justify-between p-4">
        <Button
          variant="outline"
          onClick={onPrevious}
          className="rounded-full gap-2 shadow-md"
          disabled={!hasPrevious}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden md:block">{t("common.previous")}</span>
        </Button>
        <div className="text-sm text-muted-foreground">
          {t("book.chapter_count", {
            current: currentChapterIndex + 1,
            total: book.chapters.length,
          })}
        </div>
        <Button
          variant="outline"
          onClick={onNext}
          disabled={!hasNext}
          className="rounded-full gap-2 shadow-md"
        >
          <span className="hidden md:block">{t("common.next")}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
