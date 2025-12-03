/**
 * Hook for calling onChapterLoaded callback when chapter content is ready
 * No useEffects - uses explicit check in render
 */

import { useRef } from "react";
import type { Chapter } from "../../types/reader";

export function useChapterLoadedCallback(
  chapter: Chapter | undefined,
  onChapterLoaded?: () => void
) {
  const chapterLoadedRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  // Check if we should call onChapterLoaded (explicit check, no useEffect)
  if (chapter && onChapterLoaded && chapter.contentHtml) {
    if (chapterLoadedRef.current !== chapter.id) {
      chapterLoadedRef.current = chapter.id;
      
      // Clear previous timeout
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      
      // Call after a brief delay to ensure DOM is ready
      timeoutRef.current = window.setTimeout(() => {
        onChapterLoaded();
        timeoutRef.current = null;
      }, 100);
    }
  }

  return {
    // Expose cleanup if needed
    cleanup: () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    },
  };
}

