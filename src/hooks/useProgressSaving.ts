import { useCallback } from "react";
import { logger } from "../lib/logger";

/**
 * Hook for saving progress before navigation or chapter changes
 * Extracts the common pattern of saving progress and flushing updates
 */
export function useProgressSaving(
  saveProgressRef: React.MutableRefObject<(() => void) | null>,
  activeChapterId: string | undefined,
  activeBookId: string | undefined,
  flushProgressUpdate: () => Promise<void>
) {
  return useCallback(
    async (context: {
      toChapterId?: string;
      source: string;
      additionalData?: Record<string, unknown>;
    }) => {
      if (saveProgressRef.current && activeChapterId) {
        logger.log("[App] Saving progress", {
          bookId: activeBookId,
          fromChapterId: activeChapterId,
          toChapterId: context.toChapterId,
          source: context.source,
          ...context.additionalData,
        });
        saveProgressRef.current();
        // Flush the debounced save immediately
        await flushProgressUpdate();
      }
    },
    // Note: saveProgressRef is intentionally omitted from deps as refs don't need to be in dependency arrays
    [activeChapterId, activeBookId, flushProgressUpdate]
  );
}

