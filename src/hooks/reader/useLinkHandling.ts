/**
 * Hook for handling link clicks in chapter content
 * No useEffects - uses ref callback pattern
 */

import { useCallback, useRef } from "react";
import type { Book, Chapter } from "../../types/reader";
import type { ChapterSelectionOptions } from "../../components/reader/types";
import { scrollToElement } from "../../lib/scroll-utils";

export function useLinkHandling(
  contentRef: React.RefObject<HTMLDivElement | null>,
  book: Book | undefined,
  onSelectChapter: (chapterId: string, options?: ChapterSelectionOptions) => void
) {
  const handlerRef = useRef<((event: MouseEvent) => void) | null>(null);

  const setupLinkHandler = useCallback(() => {
    const root = contentRef.current;
    if (!root || !book) return;

    // Remove old handler if exists
    if (handlerRef.current) {
      root.removeEventListener("click", handlerRef.current);
    }

    const handler = (event: MouseEvent) => {
      const element = (event.target as HTMLElement | null)?.closest("a");
      if (!(element instanceof HTMLAnchorElement)) return;

      const href = element.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("mailto:")) {
        return;
      }

      event.preventDefault();

      if (href.startsWith("#")) {
        const fragment = href.slice(1);
        scrollToElement(root, fragment, "smooth");
        return;
      }

      const [pathPart, fragmentPart] = href.split("#");
      const normalized = pathPart.replace(/^\.\//, "");

      const match = book.chapters.find((chapter) => {
        const chapterPath = chapter.href.split("#")[0];
        return (
          chapterPath === normalized ||
          chapterPath.endsWith(normalized) ||
          normalized.endsWith(chapterPath)
        );
      });

      if (match) {
        onSelectChapter(match.id, { fragment: fragmentPart, isManualSelection: true });
      }
    };

    handlerRef.current = handler;
    root.addEventListener("click", handler);
  }, [contentRef, book, onSelectChapter]);

  const cleanup = useCallback(() => {
    const root = contentRef.current;
    if (root && handlerRef.current) {
      root.removeEventListener("click", handlerRef.current);
      handlerRef.current = null;
    }
  }, [contentRef]);

  return {
    setupLinkHandler,
    cleanup,
  };
}

