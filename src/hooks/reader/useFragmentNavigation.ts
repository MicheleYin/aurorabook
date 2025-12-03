/**
 * Hook for handling fragment navigation
 * No useEffects - uses explicit callbacks
 */

import { useCallback, useRef } from "react";
import { scrollToElement } from "../../lib/scroll-utils";

export function useFragmentNavigation(
  contentRef: React.RefObject<HTMLDivElement | null>,
  onFragmentConsumed?: () => void
) {
  const lastFragmentRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const navigateToFragment = useCallback((fragment: string | null) => {
    if (!fragment) return;

    // Skip if same fragment
    if (lastFragmentRef.current === fragment) return;
    lastFragmentRef.current = fragment;

    const node = contentRef.current;
    if (!node) {
      onFragmentConsumed?.();
      return;
    }

    // Cancel previous animation
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    const cleanFragment = fragment.replace(/^#/, "");
    rafIdRef.current = requestAnimationFrame(() => {
      scrollToElement(node, cleanFragment, "smooth");
      onFragmentConsumed?.();
      rafIdRef.current = null;
    });
  }, [contentRef, onFragmentConsumed]);

  return {
    navigateToFragment,
  };
}

