/**
 * HighlightQueueContext - Manages a queue of highlight requests
 * Audio sync pushes highlights, reader components pop and render them
 */

import { createContext, useContext, useCallback, useState } from "react";

type HighlightAction = 
  | { type: 'clear' }
  | { type: 'highlight'; elementId: string };

type HighlightQueueContextValue = {
  queue: HighlightAction[];
  pushHighlight: (elementId: string | null) => void;
  popQueue: () => void;
  clearQueue: () => void;
};

const HighlightQueueContext = createContext<HighlightQueueContextValue | null>(null);

export function HighlightQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<HighlightAction[]>([]);
  
  const pushHighlight = useCallback((elementId: string | null) => {
    setQueue(prev => {
      // If clearing, add clear action
      if (!elementId) {
        return [...prev, { type: 'clear' }];
      }
      // Otherwise add highlight action
      return [...prev, { type: 'highlight', elementId }];
    });
  }, []);
  
  const popQueue = useCallback(() => {
    setQueue(prev => {
      if (prev.length === 0) return prev;
      return prev.slice(1);
    });
  }, []);
  
  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);
  
  return (
    <HighlightQueueContext.Provider value={{ queue, pushHighlight, popQueue, clearQueue }}>
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
