/**
 * Hook for calling onChapterLoaded callback when chapter content is ready in the DOM
 * No useEffects - uses explicit check in render
 * Waits for the chapter content element to be in the DOM before calling the callback
 */

import { useRef } from "react";
import type { Chapter } from "../../types/reader";
import { useReaderCoordinator } from "../../contexts/ReaderCoordinatorContext";

export function useChapterLoadedCallback(
  chapter: Chapter | undefined,
  onChapterLoaded?: () => void
) {
  const coordinator = useReaderCoordinator();
  const chapterLoadedRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Check if we should call onChapterLoaded (explicit check, no useEffect)
  if (chapter && onChapterLoaded && chapter.contentHtml) {
    if (chapterLoadedRef.current !== chapter.id) {
      chapterLoadedRef.current = chapter.id;
      
      // Clear previous timeouts/animations
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      
      // Wait for next paint, then check if content is in DOM
      console.log("[useChapterLoadedCallback] Chapter changed, waiting for DOM", {
        chapterId: chapter.id,
        hasContentHtml: !!chapter.contentHtml,
      });
      
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        
        let attempts = 0;
        const maxAttempts = 20; // 20 * 50ms = 1 second max wait
        
        // Check if chapter content element is in the DOM
        const checkContentInDOM = () => {
          attempts++;
          const contentElement = document.querySelector(
            `[data-reader-chapter-content="true"][data-chapter-id="${chapter.id}"]`
          );
          
          if (contentElement) {
            // Check if chapter change operation was cancelled
            const currentOp = coordinator.getCurrentOperation("changeChapter");
            if (currentOp?.cancelled || currentOp?.chapterId !== chapter.id) {
              console.log("[useChapterLoadedCallback] Chapter change was cancelled, skipping callback", {
                chapterId: chapter.id,
                operationId: currentOp?.id,
              });
              return;
            }
            
            // Content is in DOM, call callback
            console.log("[useChapterLoadedCallback] ✓ Chapter content found in DOM, calling onChapterLoaded", {
              chapterId: chapter.id,
              attempts,
              elementFound: !!contentElement,
              callbackExists: !!onChapterLoaded,
            });
            try {
              if (onChapterLoaded) {
                onChapterLoaded();
                console.log("[useChapterLoadedCallback] ✓ onChapterLoaded called successfully");
              } else {
                console.error("[useChapterLoadedCallback] ✗ onChapterLoaded is undefined!");
              }
            } catch (error) {
              console.error("[useChapterLoadedCallback] ✗ Error calling onChapterLoaded:", error);
            }
          } else if (attempts < maxAttempts) {
            // Content not yet in DOM, try again after a short delay
            if (attempts === 1 || attempts % 5 === 0) {
              console.log("[useChapterLoadedCallback] Waiting for chapter content in DOM", {
                chapterId: chapter.id,
                attempts,
                maxAttempts,
              });
            }
            timeoutRef.current = window.setTimeout(() => {
              timeoutRef.current = null;
              checkContentInDOM();
            }, 50);
          } else {
            // Max attempts reached, call anyway (content might be there but selector is wrong)
            console.warn("[useChapterLoadedCallback] Max attempts reached, calling onChapterLoaded anyway", {
              chapterId: chapter.id,
              attempts,
              callbackExists: !!onChapterLoaded,
            });
            try {
              if (onChapterLoaded) {
                onChapterLoaded();
                console.log("[useChapterLoadedCallback] ✓ onChapterLoaded called successfully (max attempts)");
              } else {
                console.error("[useChapterLoadedCallback] ✗ onChapterLoaded is undefined (max attempts)!");
              }
            } catch (error) {
              console.error("[useChapterLoadedCallback] ✗ Error calling onChapterLoaded (max attempts):", error);
            }
          }
        };
        
        // Start checking
        checkContentInDOM();
      });
    }
  }

  return {
    // Expose cleanup if needed
    cleanup: () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
  };
}

