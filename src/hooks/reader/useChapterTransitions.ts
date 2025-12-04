/**
 * Hook for chapter transition animations
 * No useEffects - transitions triggered explicitly
 */

import { useCallback, useRef, useState } from "react";
import type { Book, Chapter } from "../../types/reader";

export function useChapterTransitions() {
  const [direction, setDirection] = useState<"left" | "right" | "fade" | null>(null);
  const previousChapterIdRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<number | null>(null);

  const triggerTransition = useCallback((
    currentChapter: Chapter | undefined,
    book: Book | undefined
  ) => {
    const currentId = currentChapter?.id;
    const previousId = previousChapterIdRef.current;

    if (!currentId || !previousId || currentId === previousId) {
      previousChapterIdRef.current = currentId;
      return;
    }

    // Clear previous timer
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    // Determine direction
    if (book) {
      const prevIndex = book.chapters.findIndex(ch => ch.id === previousId);
      const currentIndex = book.chapters.findIndex(ch => ch.id === currentId);
      
      if (prevIndex !== -1 && currentIndex !== -1) {
        setDirection(currentIndex > prevIndex ? "left" : "right");
      } else {
        setDirection("fade");
      }
    } else {
      setDirection("fade");
    }

    // Reset after animation
    timerRef.current = window.setTimeout(() => {
      setDirection(null);
      timerRef.current = null;
    }, 300);

    previousChapterIdRef.current = currentId;
  }, []);

  return {
    direction,
    triggerTransition,
  };
}

