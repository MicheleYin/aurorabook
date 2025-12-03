/**
 * Hook for tracking scroll state (UI only)
 * No useEffects - uses ref callback pattern
 */

import { useCallback, useRef, useState } from "react";

export function useScrollTracking() {
  const [isScrolling, setIsScrolling] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    setIsScrolling(true);
    
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = window.setTimeout(() => {
      setIsScrolling(false);
      timeoutRef.current = null;
    }, 200);
  }, []);

  return {
    isScrolling,
    scrollHandler: handleScroll,
  };
}

