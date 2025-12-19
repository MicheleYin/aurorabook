import { useEffect, useMemo, useRef } from "react";
import { logger } from "../lib/logger";
import type { LibraryFilterOption, LibraryViewMode } from "../components/library/types";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  selectCurrentTab,
  selectLibrarySearchTerm,
  selectLibraryFilter,
  selectLibraryViewMode,
  selectLibrary,
} from "../store/selectors";
import {
  setCurrentTab,
  setLibrarySearchTerm,
  setLibraryFilter,
  setLibraryViewMode,
} from "../store/slices/navigationSlice";

export type AppView = "library" | "reader" | "settings";

export function useAppNavigation(
  refreshLibrary: () => Promise<void>,
  isHydrated: boolean,
) {
  const dispatch = useAppDispatch();
  const activeView = useAppSelector(selectCurrentTab);
  const librarySearchTerm = useAppSelector(selectLibrarySearchTerm);
  const libraryFilter = useAppSelector(selectLibraryFilter);
  const libraryViewMode = useAppSelector(selectLibraryViewMode);
  const library = useAppSelector(selectLibrary);
  const previousViewRef = useRef<AppView>(activeView);

  // Refresh library on mount when hydrated (no longer triggered by filter/search changes)
  useEffect(() => {
    if (!isHydrated) return;
    refreshLibrary().catch((error) => {
      logger.error("Failed to refresh library:", error);
    });
  }, [isHydrated, refreshLibrary]);

  useEffect(() => {
    if (!library.length) {
      dispatch(setCurrentTab("library"));
    }
  }, [library.length, dispatch]);

  useEffect(() => {
    previousViewRef.current = activeView;
  }, [activeView]);

  const canOpenReader = useMemo(() => {
    return library.length > 0;
  }, [library.length]);

  const navigationItems: Array<{ id: AppView; label: string; disabled?: boolean }> = useMemo(() => [
    { id: "library", label: "Library" },
    { id: "reader", label: "Reader", disabled: !canOpenReader },
    { id: "settings", label: "Settings" },
  ], [canOpenReader]);

  return {
    activeView,
    setActiveView: (view: AppView) => dispatch(setCurrentTab(view)),
    librarySearchTerm,
    setLibrarySearchTerm: (term: string) => dispatch(setLibrarySearchTerm(term)),
    libraryFilter,
    setLibraryFilter: (filter: LibraryFilterOption) => dispatch(setLibraryFilter(filter)),
    libraryViewMode,
    setLibraryViewMode: (mode: LibraryViewMode) => dispatch(setLibraryViewMode(mode)),
    navigationItems,
    previousViewRef,
  };
}

