/**
 * HighlightQueueContext - Manages a queue of highlight requests
 * Uses refs instead of state to avoid React re-renders
 * All highlighting is done via pure DOM manipulation
 */

import { createContext, useContext, useCallback, useRef } from "react";

type HighlightAction = 
  | { type: 'clear' }
  | { type: 'highlight'; elementId: string };

type HighlightQueueContextValue = {
  pushHighlight: (elementId: string | null) => void;
  clearQueue: () => void;
  // Internal: get queue for processing (used by useHighlighting)
  _getQueue: () => HighlightAction[];
  _popQueue: () => void;
};

const HighlightQueueContext = createContext<HighlightQueueContextValue | null>(null);

export function HighlightQueueProvider({ children }: { children: React.ReactNode }) {
  // Use ref instead of state to avoid re-renders
  // Limit queue size to prevent memory leaks
  const MAX_QUEUE_SIZE = 10;
  const queueRef = useRef<HighlightAction[]>([]);
  
  const pushHighlight = useCallback((elementId: string | null) => {
    // Directly manipulate queue ref - no React state update
    const action: HighlightAction = !elementId 
      ? { type: 'clear' }
      : { type: 'highlight', elementId };
    
    // If queue has items and last item is the same highlight, skip (debounce)
    if (action.type === 'highlight') {
      const lastItem = queueRef.current[queueRef.current.length - 1];
      if (lastItem?.type === 'highlight' && lastItem.elementId === elementId) {
        return; // Skip duplicate highlights
      }
    }
    
    // Always allow new items - drop oldest items if queue would exceed max size
    // This ensures the queue never blocks new highlights, just drops old ones
    if (queueRef.current.length >= MAX_QUEUE_SIZE) {
      // Drop oldest items to make room for the new one
      // Keep only the most recent (MAX_QUEUE_SIZE - 1) items, then add the new one
      queueRef.current = queueRef.current.slice(-(MAX_QUEUE_SIZE - 1));
    }
    
    // Add the new action
    queueRef.current.push(action);
    
    // Trigger processing via custom event (non-React way)
    // This allows useHighlighting to process without causing re-renders
    window.dispatchEvent(new CustomEvent('highlight-queue-updated'));
  }, []);
  
  const clearQueue = useCallback(() => {
    queueRef.current = [];
  }, []);
  
  // Internal methods for useHighlighting to access queue
  const _getQueue = useCallback(() => {
    return queueRef.current;
  }, []);
  
  const _popQueue = useCallback(() => {
    if (queueRef.current.length > 0) {
      queueRef.current = queueRef.current.slice(1);
    }
  }, []);
  
  return (
    <HighlightQueueContext.Provider value={{ pushHighlight, clearQueue, _getQueue, _popQueue }}>
      {children}
    </HighlightQueueContext.Provider>
  );
}

export function useHighlightQueue() {
  const context = useContext(HighlightQueueContext);
  if (!context) {
    throw new Error('useHighlightQueue must be used within HighlightQueueProvider');
  }
  return context;
}
