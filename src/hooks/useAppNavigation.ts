import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryFilterOption, LibraryViewMode } from "../components/library/types";
import type { Book } from "../types/reader";
import type { LibraryFilter } from "../lib/book-service";

export type AppView = "library" | "reader" | "settings";

export function useAppNavigation(
  library: Book[],
  refreshLibrary: (filter?: LibraryFilter) => Promise<void>,
  isHydrated: boolean,
) {
  const [activeView, setActiveView] = useState<AppView>("library");
  const [librarySearchTerm, setLibrarySearchTerm] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilterOption>("all");
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("grid");
  const previousViewRef = useRef<AppView>(activeView);

  // Use backend filtering/search - refresh library when filter or search changes
  useEffect(() => {
    if (!isHydrated) return;
    
    const filter: LibraryFilter = {
      filter: libraryFilter !== "all" ? libraryFilter : undefined,
      search: librarySearchTerm.trim() || undefined,
    };
    
    refreshLibrary(filter).catch((error) => {
      console.error("Failed to refresh library with filter:", error);
    });
  }, [libraryFilter, librarySearchTerm, isHydrated, refreshLibrary]);

  useEffect(() => {
    if (!library.length) {
      setActiveView("library");
    }
  }, [library.length]);

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
    setActiveView,
    librarySearchTerm,
    setLibrarySearchTerm,
    libraryFilter,
    setLibraryFilter,
    libraryViewMode,
    setLibraryViewMode,
    navigationItems,
    previousViewRef,
  };
}

