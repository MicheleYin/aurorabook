import { useEffect, useState } from "react";

import type { ReaderPanelBaseProps } from "./reader/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { ReaderSettingsControl } from "./reader/ReaderSettingsControl";
import { ReaderTocDrawer } from "./reader/ReaderTocDrawer";
import { ReaderViewport } from "./reader/ReaderViewport";

type ReaderPanelProps = ReaderPanelBaseProps;

export function ReaderPanel({
  activeBook,
  activeChapter,
  preferences,
  onPreferencesChange,
  onSelectChapter,
  pendingFragment,
  onFragmentConsumed,
}: ReaderPanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);

  useEffect(() => {
    setIsTocOpen(false);
  }, [activeBook?.id]);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{activeChapter?.title ?? "Select a chapter"}</CardTitle>
            <CardDescription>
              {activeBook
                ? `${activeBook.title} · ${activeBook.author}`
                : "Add an ebook to begin reading."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeBook && (
              <ReaderTocDrawer
                book={activeBook}
                activeChapterId={activeChapter?.id}
                isOpen={isTocOpen}
                onOpenChange={setIsTocOpen}
                onSelectChapter={onSelectChapter}
              />
            )}
            <ReaderSettingsControl
              preferences={preferences}
              onPreferencesChange={onPreferencesChange}
              isOpen={isSettingsOpen}
              onOpenChange={setIsSettingsOpen}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 overflow-hidden">
        <ReaderViewport
          activeBook={activeBook}
          activeChapter={activeChapter}
          preferences={preferences}
          pendingFragment={pendingFragment}
          onFragmentConsumed={onFragmentConsumed}
          onSelectChapter={onSelectChapter}
        />
      </CardContent>
    </Card>
  );
}
