import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Settings2,
  X,
} from "lucide-react";

import type { Book, Chapter, ReaderPreferences } from "../types/reader";
import { cn } from "../lib/utils";
import { useMediaQuery } from "../hooks/use-media-query";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader as DialogModalHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader as DrawerModalHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerHandle,
  DrawerClose,
} from "./ui/drawer";
import { ScrollArea } from "./ui/scroll-area";

type ReaderPanelProps = {
  activeBook?: Book;
  activeChapter?: Chapter;
  preferences: ReaderPreferences;
  onPreferencesChange: (update: Partial<ReaderPreferences>) => void;
  onSelectChapter: (chapterId: string, fragment?: string) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  pendingFragment: string | null;
  onFragmentConsumed: () => void;
};

const themeClasses: Record<ReaderPreferences["theme"], string> = {
  light: "bg-white text-slate-900 border border-slate-200",
  dark: "bg-zinc-950 text-zinc-100 border border-zinc-800",
  sepia: "bg-[#f4ecd8] text-[#403127] border border-[#e0cfb0]",
};

const fontClassMap: Record<ReaderPreferences["fontFamily"], string> = {
  merriweather: "font-merriweather",
  inter: "font-inter",
  lora: "font-lora",
  firaMono: "font-fira-mono",
  atkinson: "font-readable",
};

const fontPreviewText: Record<ReaderPreferences["fontFamily"], string> = {
  merriweather: "Aa",
  inter: "Aa",
  lora: "Aa",
  firaMono: "Aa",
  atkinson: "Aa",
};

const BASE_FONT_CLASS = "text-[18px]";
const BASE_LINE_HEIGHT_CLASS = "leading-[1.6]";

const fontOptions: Array<{ id: ReaderPreferences["fontFamily"]; label: string }> = [
  { id: "merriweather", label: "Merriweather" },
  { id: "inter", label: "Inter" },
  { id: "lora", label: "Lora" },
  { id: "firaMono", label: "Fira Mono" },
  { id: "atkinson", label: "Atkinson" },
];

const themeOptions: Array<{ id: ReaderPreferences["theme"]; label: string }> = [
  { id: "light", label: "Light" },
  { id: "sepia", label: "Sepia" },
  { id: "dark", label: "Dark" },
];

export function ReaderPanel({
  activeBook,
  activeChapter,
  preferences,
  onPreferencesChange,
  onSelectChapter,
  onPrevChapter,
  onNextChapter,
  pendingFragment,
  onFragmentConsumed,
}: ReaderPanelProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const fontOptionRefs = useRef<Record<ReaderPreferences["fontFamily"], HTMLButtonElement | null>>({
    merriweather: null,
    inter: null,
    lora: null,
    firaMono: null,
    atkinson: null,
  });
  const [pageState, setPageState] = useState({ current: 1, total: 1 });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const currentChapterIndex = useMemo(() => {
    if (!activeBook || !activeChapter) return -1;
    return activeBook.chapters.findIndex(
      (chapter) => chapter.id === activeChapter.id,
    );
  }, [activeBook, activeChapter]);

  const hasPrevChapter = currentChapterIndex > 0;
  const hasNextChapter =
    !!activeBook && currentChapterIndex < activeBook.chapters.length - 1;

  const handlePageStep = useCallback((direction: 1 | -1) => {
    const el = contentRef.current;
    if (!el) return;
    el.scrollBy({
      top: direction * el.clientHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    const activeButton = fontOptionRefs.current[preferences.fontFamily];
    activeButton?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [preferences.fontFamily]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const computePages = () => {
      const total = Math.max(1, Math.ceil(el.scrollHeight / el.clientHeight));
      const current = Math.min(
        total,
        Math.floor(el.scrollTop / el.clientHeight) + 1,
      );
      setPageState({ current, total });
    };

    computePages();
    el.addEventListener("scroll", computePages);
    window.addEventListener("resize", computePages);

    return () => {
      el.removeEventListener("scroll", computePages);
      window.removeEventListener("resize", computePages);
    };
  }, [activeChapter?.id, preferences.fontFamily]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.scrollTo({ top: 0 });
  }, [activeChapter?.id, preferences.fontFamily]);

  useEffect(() => {
    if (!pendingFragment) return;
    const el = contentRef.current;
    if (!el) return;

    const fragment = pendingFragment.replace(/^#/, "");

    const scrollToFragment = () => {
      const selector =
        typeof CSS !== "undefined" && CSS.escape
          ? `#${CSS.escape(fragment)}`
          : `#${fragment}`;
      const target =
        el.querySelector<HTMLElement>(selector) ??
        el.querySelector<HTMLElement>(`a[name="${fragment}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      onFragmentConsumed();
    };

    const id = requestAnimationFrame(scrollToFragment);
    return () => cancelAnimationFrame(id);
  }, [pendingFragment, onFragmentConsumed, activeChapter?.id]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || !activeBook) return;

    const handler = (event: MouseEvent) => {
      const element = (event.target as HTMLElement | null)?.closest("a");
      if (!(element instanceof HTMLAnchorElement)) return;

      const href = element.getAttribute("href");
      if (!href) return;

      if (href.startsWith("http") || href.startsWith("mailto:")) {
        return;
      }

      event.preventDefault();

      if (href.startsWith("#")) {
        const fragment = href.slice(1);
        const selector =
          typeof CSS !== "undefined" && CSS.escape
            ? `#${CSS.escape(fragment)}`
            : `#${fragment}`;
        const target =
          el.querySelector<HTMLElement>(selector) ??
          el.querySelector<HTMLElement>(`a[name="${fragment}"]`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }

      const [pathPart, fragmentPart] = href.split("#");
      const normalized = pathPart.replace(/^\.\//, "");
      const match = activeBook.chapters.find((chapter) => {
        const chapterPath = chapter.href.split("#")[0];
        return (
          chapterPath === normalized ||
          chapterPath.endsWith(normalized) ||
          normalized.endsWith(chapterPath)
        );
      });

      if (match) {
        onSelectChapter(match.id, fragmentPart);
      }
    };

    el.addEventListener("click", handler);
    return () => {
      el.removeEventListener("click", handler);
    };
  }, [activeBook, onSelectChapter, activeChapter?.id]);

  const renderChapterList = (className?: string) => {
    if (!activeBook) return null;
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        {activeBook.chapters.map((chapter) => {
          const isActive = chapter.id === activeChapter?.id;
          return (
            <Button
              key={chapter.id}
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              onClick={() => onSelectChapter(chapter.id)}
            >
              <span className="line-clamp-1">{chapter.title}</span>
            </Button>
          );
        })}
      </div>
    );
  };

  const settingsBody = (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">
          Theme
        </h3>
        <div className="flex flex-wrap gap-2">
          {themeOptions.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={preferences.theme === option.id ? "secondary" : "ghost"}
              onClick={() => onPreferencesChange({ theme: option.id })}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-4 rounded-full border",
                    option.id === "light" && "bg-white border-slate-300",
                    option.id === "dark" && "bg-zinc-900 border-zinc-700",
                    option.id === "sepia" && "bg-[#f4ecd8] border-[#e0cfb0]",
                  )}
                />
                {option.label}
              </span>
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">
          Font
        </h3>
        <div className="overflow-x-auto whitespace-nowrap pb-2 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex gap-2">
            {fontOptions.map((option) => (
              <Button
                key={option.id}
                ref={(node) => {
                  fontOptionRefs.current[option.id] = node;
                }}
                size="sm"
                variant={preferences.fontFamily === option.id ? "secondary" : "ghost"}
                onClick={() => onPreferencesChange({ fontFamily: option.id })}
                className="min-w-[140px] flex-shrink-0 snap-start flex-col items-start gap-1"
              >
                <span className={cn("text-lg leading-none", fontClassMap[option.id])}>
                  {fontPreviewText[option.id]}
                </span>
                <span className="text-xs text-muted-foreground">{option.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <Card className="flex h-[600px] flex-col lg:h-[640px]">
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
          <div className="flex items-center gap-2">
            {isDesktop ? (
              <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Settings2 className="mr-2 h-4 w-4" />
                    Reader settings
                  </Button>
                </DialogTrigger>
                <DialogContent className="fixed inset-x-0 bottom-0 top-auto w-full max-h-[85vh] overflow-hidden rounded-t-3xl border bg-card p-6 shadow-2xl duration-200 sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6 sm:shadow-lg">
                  <DialogModalHeader>
                    <DialogTitle>Reader preferences</DialogTitle>
                    <DialogDescription>
                      Personalise the reading experience to match your environment.
                    </DialogDescription>
                  </DialogModalHeader>
                  <div className="mt-4 max-h-[65vh] overflow-y-auto pr-2 sm:pr-0">
                    {settingsBody}
                  </div>
                </DialogContent>
              </Dialog>
            ) : (
              <Drawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DrawerTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Settings2 className="mr-2 h-4 w-4" />
                    Reader settings
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHandle className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
                  <DrawerModalHeader className="flex flex-row items-start justify-between text-left">
                    <div>
                      <DrawerTitle className="text-lg font-semibold">Reader preferences</DrawerTitle>
                      <DrawerDescription>
                        Personalise the reading experience to match your environment.
                      </DrawerDescription>
                    </div>
                    <DrawerClose asChild>
                      <Button variant="ghost" size="icon" aria-label="Close reader settings">
                        <X className="h-4 w-4" />
                      </Button>
                    </DrawerClose>
                  </DrawerModalHeader>
                  <div className="mt-4 max-h-[65vh] overflow-y-auto pr-2">
                    {settingsBody}
                  </div>
                </DrawerContent>
              </Drawer>
            )}
          </div>
        </div>

        {activeBook && (
          <details className="lg:hidden">
            <summary className="cursor-pointer text-sm font-medium">
              Table of contents
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {renderChapterList()}
            </div>
          </details>
        )}
      </CardHeader>

      <CardContent className="flex flex-1 gap-6 overflow-hidden">
        {activeBook && (
          <aside className="hidden w-60 flex-shrink-0 flex-col lg:flex">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase text-muted-foreground">
              <BookOpen className="h-4 w-4" />
              Table of contents
            </div>
            <ScrollArea className="h-full rounded-md border">
              <div className="p-2">{renderChapterList("gap-1")}</div>
            </ScrollArea>
          </aside>
        )}

          <div className="flex flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePageStep(-1)}
                disabled={pageState.current <= 1}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Page
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePageStep(1)}
                disabled={pageState.current >= pageState.total}
              >
                Page
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
              <span>
                {pageState.current} / {pageState.total}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={onPrevChapter}
                disabled={!hasPrevChapter}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Chapter
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onNextChapter}
                disabled={!hasNextChapter}
              >
                Chapter
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
              <span>
                {currentChapterIndex + 1 > 0
                  ? `${currentChapterIndex + 1} of ${activeBook?.chapters.length ?? 0}`
                  : ""}
              </span>
            </div>
          </div>

          <div
            ref={contentRef}
            className={cn(
              "flex-1 overflow-y-auto rounded-lg p-6 shadow-inner transition duration-300",
              themeClasses[preferences.theme],
              BASE_FONT_CLASS,
              BASE_LINE_HEIGHT_CLASS,
              fontClassMap[preferences.fontFamily],
            )}
          >
            <div
              className={cn(
                "prose max-w-none transition-colors",
                preferences.theme === "dark" ? "prose-invert" : "prose-neutral",
              )}
            >
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
