import type { Book, Chapter } from "../types/reader";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";

type ReaderPanelProps = {
  activeBook?: Book;
  activeChapter?: Chapter;
};

export function ReaderPanel({ activeBook, activeChapter }: ReaderPanelProps) {
  return (
    <Card className="h-[520px] lg:h-[600px]">
      <CardHeader className="space-y-2">
        <CardTitle>{activeChapter?.title ?? "Select a chapter"}</CardTitle>
        <CardDescription>
          {activeBook
            ? `${activeBook.title} · ${activeBook.author}`
            : "Add an ebook to begin reading."}
        </CardDescription>
      </CardHeader>
      <CardContent className="h-full">
        <ScrollArea className="h-full rounded-md border p-4">
          <div className="prose prose-neutral max-w-none dark:prose-invert">
            {activeChapter ? (
              <div
                dangerouslySetInnerHTML={{
                  __html: activeChapter.contentHtml,
                }}
              />
            ) : (
              <p className="text-muted-foreground">
                Once you import an EPUB, pick a chapter to start reading.
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

