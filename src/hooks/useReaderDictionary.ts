import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  dictionaryCardLayout,
  isDictionaryCardTarget,
  snapshotReaderSelection,
  type DictionaryCardLayout,
  type DictionaryLookupResult,
  type SelectionRect,
} from "../lib/reader-dictionary";
import { logger } from "../lib/logger";

export type ReaderDictionaryState = {
  term: string;
  definition: string | null;
  loading: boolean;
  layout: DictionaryCardLayout;
};

export function useReaderDictionary(
  contentRef: React.RefObject<HTMLElement | null>
) {
  const [state, setState] = useState<ReaderDictionaryState | null>(null);
  const requestIdRef = useRef(0);
  const openRef = useRef(false);
  const suppressChromeToggleRef = useRef(false);

  openRef.current = state !== null;

  const close = useCallback(() => {
    requestIdRef.current += 1;
    setState(null);
  }, []);

  const consumeChromeToggleSuppression = useCallback(() => {
    if (!suppressChromeToggleRef.current) {
      return false;
    }
    suppressChromeToggleRef.current = false;
    return true;
  }, []);

  const lookupCurrentSelection = useCallback(async () => {
    const snapshot = snapshotReaderSelection(contentRef.current);
    if (!snapshot) {
      if (openRef.current) {
        suppressChromeToggleRef.current = true;
        close();
      }
      return;
    }

    const layout = dictionaryCardLayout(snapshot.rect, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState({
      term: snapshot.query,
      definition: null,
      loading: true,
      layout,
    });

    try {
      const result = await invoke<DictionaryLookupResult>("lookup_dictionary", {
        term: snapshot.query,
      });
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState({
        term: result.term || snapshot.query,
        definition: result.definition,
        loading: false,
        layout,
      });
    } catch (error) {
      logger.warn("[reader-dictionary] lookup failed", error);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setState({
        term: snapshot.query,
        definition: null,
        loading: false,
        layout,
      });
    }
  }, [close, contentRef]);

  useEffect(() => {
    const handlePointerUp = (event: PointerEvent) => {
      if (isDictionaryCardTarget(event.target)) {
        return;
      }
      window.setTimeout(() => {
        void lookupCurrentSelection();
      }, 0);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (openRef.current) {
          suppressChromeToggleRef.current = true;
          window.getSelection()?.removeAllRanges();
          close();
        }
        return;
      }
      if (event.shiftKey || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        window.setTimeout(() => {
          void lookupCurrentSelection();
        }, 0);
      }
    };

    const handleScroll = (event: Event) => {
      if (!openRef.current) {
        return;
      }
      if (isDictionaryCardTarget(event.target)) {
        return;
      }
      suppressChromeToggleRef.current = true;
      close();
    };

    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [close, lookupCurrentSelection]);

  const updateLayoutFromRect = useCallback((rect: SelectionRect) => {
    setState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        layout: dictionaryCardLayout(rect, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      };
    });
  }, []);

  useEffect(() => {
    if (!state) {
      return;
    }
    const handleReposition = () => {
      const snapshot = snapshotReaderSelection(contentRef.current);
      if (!snapshot) {
        return;
      }
      updateLayoutFromRect(snapshot.rect);
    };
    window.addEventListener("resize", handleReposition);
    return () => {
      window.removeEventListener("resize", handleReposition);
    };
  }, [contentRef, state, updateLayoutFromRect]);

  return {
    dictionary: state,
    isOpen: state !== null,
    close,
    consumeChromeToggleSuppression,
  };
}
