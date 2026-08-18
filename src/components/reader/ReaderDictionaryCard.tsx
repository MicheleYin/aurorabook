import { createPortal } from "react-dom";
import { BookOpen, X } from "lucide-react";

import type { ReaderDictionaryState } from "../../hooks/useReaderDictionary";
import { useTranslation } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

interface ReaderDictionaryCardProps {
  dictionary: ReaderDictionaryState;
  onClose: () => void;
  themeClass?: string;
}

function DictionaryBody({
  dictionary,
  lookingUpLabel,
  notFoundLabel,
}: Readonly<{
  dictionary: ReaderDictionaryState;
  lookingUpLabel: string;
  notFoundLabel: string;
}>) {
  if (dictionary.loading) {
    return <p className="text-sm text-muted-foreground">{lookingUpLabel}</p>;
  }
  if (dictionary.definition) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {dictionary.definition}
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">{notFoundLabel}</p>;
}

export function ReaderDictionaryCard({
  dictionary,
  onClose,
  themeClass,
}: Readonly<ReaderDictionaryCardProps>) {
  const { t } = useTranslation();
  const { layout } = dictionary;

  const handleClose = () => {
    window.getSelection()?.removeAllRanges();
    onClose();
  };

  return createPortal(
    <dialog
      open
      data-reader-dictionary-card=""
      aria-label={t("reader.dictionary.title")}
      className={cn(
        "fixed z-[60] m-0 overflow-hidden rounded-2xl border bg-card/95 p-0 shadow-xl backdrop-blur-md",
        "text-card-foreground",
        themeClass
      )}
      style={{
        top: layout.top ?? "auto",
        bottom: layout.bottom ?? "auto",
        left: layout.left,
        right: "auto",
        width: layout.width,
        maxHeight: layout.maxHeight,
      }}
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
    >
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("reader.dictionary.title")}
          </p>
          <h2 className="truncate text-xl font-semibold leading-tight">
            {dictionary.term}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleClose}
          aria-label={t("reader.dictionary.close")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div
        className="overflow-y-auto px-4 py-3"
        style={{ maxHeight: Math.max(80, layout.maxHeight - 72) }}
      >
        <DictionaryBody
          dictionary={dictionary}
          lookingUpLabel={t("reader.dictionary.looking_up")}
          notFoundLabel={t("reader.dictionary.not_found")}
        />
      </div>
    </dialog>,
    document.body
  );
}
