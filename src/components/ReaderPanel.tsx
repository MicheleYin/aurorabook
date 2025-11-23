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
import { cn } from "../lib/utils";

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
  const [isImmersive, setIsImmersive] = useState(false);

  useEffect(() => {
    setIsTocOpen(false);
  }, [activeBook?.id]);

  useEffect(() => {
    setIsImmersive(false);
  }, [activeBook?.id, activeChapter?.id]);

  useEffect(() => {
    if (isImmersive) {
      setIsSettingsOpen(false);
      setIsTocOpen(false);
    }
  }, [isImmersive]);

  return (
    <Card
      className={cn(
        "flex h-full flex-col",
        isImmersive && "border-transparent bg-transparent shadow-none",
      )}
    >
      {!isImmersive && (
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
                  onOpenChange={(open) => {
                    setIsImmersive(false);
                    setIsTocOpen(open);
                  }}
                  onSelectChapter={onSelectChapter}
                />
              )}
              <ReaderSettingsControl
                preferences={preferences}
                onPreferencesChange={onPreferencesChange}
                isOpen={isSettingsOpen}
                onOpenChange={(open) => {
                  setIsImmersive(false);
                  setIsSettingsOpen(open);
                }}
              />
            </div>
          </div>
        </CardHeader>
      )}

      <CardContent
        className={cn(
          "flex flex-1 overflow-hidden",
          isImmersive && "p-0",
        )}
      >
        <ReaderViewport
          activeBook={activeBook}
          activeChapter={activeChapter}
          preferences={preferences}
          pendingFragment={pendingFragment}
          onFragmentConsumed={onFragmentConsumed}
          onSelectChapter={onSelectChapter}
          chromeVisible={!isImmersive}
          onToggleChrome={() => setIsImmersive((prev) => !prev)}
        />
      </CardContent>
    </Card>
  );
}
