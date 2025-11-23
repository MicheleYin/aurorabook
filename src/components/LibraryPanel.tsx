import { BookOpen, Plus } from "lucide-react";

import type { Book } from "../types/reader";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "../lib/utils";

export type LibraryPanelProps = {
  library: Book[];
  activeBookId?: string;
  activeChapterId?: string;
  isImporting: boolean;
  onAddEbook: () => void;
  onSelectBook: (bookId: string) => void;
  onSelectChapter: (bookId: string, chapterId: string) => void;
};

export function LibraryPanel({
  library,
  activeBookId,
  activeChapterId,
  isImporting,
  onAddEbook,
  onSelectBook,
  onSelectChapter,
}: LibraryPanelProps) {
  const activeBook = library.find((book) => book.id === activeBookId);

  return (
    <Card className="h-full">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-primary" />
            Library
          </CardTitle>
          <CardDescription>
            Import EPUB files and jump into any chapter instantly.
          </CardDescription>
        </div>
        <Button onClick={onAddEbook} disabled={isImporting}>
          {isImporting ? (
            "Adding…"
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Add ebook
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {library.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed p-8 text-center">
            <p className="text-sm font-medium">Your shelf is empty.</p>
            <p className="text-sm text-muted-foreground">
              Bring an EPUB into Whisperleaf to start reading and listening.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Books
              </p>
              <ScrollArea className="h-36 rounded-md border">
                <div className="flex flex-col gap-1 p-2">
                  {library.map((book) => {
                    const isActive = book.id === activeBookId;
                    return (
                      <Button
                        key={book.id}
                        variant={isActive ? "secondary" : "ghost"}
                        className={cn(
                          "justify-start text-left text-sm",
                          isActive && "font-medium",
                        )}
                        onClick={() => onSelectBook(book.id)}
                      >
                        <span className="line-clamp-2">{book.title}</span>
                      </Button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {activeBook && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Chapters
                </p>
                <ScrollArea className="h-64 rounded-md border">
                  <div className="flex flex-col gap-1 p-2">
                    {activeBook.chapters.map((chapter) => {
                      const isActive = chapter.id === activeChapterId;
                      return (
                        <Button
                          key={chapter.id}
                          variant={isActive ? "secondary" : "ghost"}
                          className={cn(
                            "justify-start text-left text-sm",
                            isActive && "font-medium",
                          )}
                          onClick={() => onSelectChapter(activeBook.id, chapter.id)}
                        >
                          <span className="line-clamp-2">{chapter.title}</span>
                        </Button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

