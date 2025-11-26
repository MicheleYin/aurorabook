import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { HiddenFileInput } from "./components/HiddenFileInput";
import { LibraryPanel } from "./components/LibraryPanel";
import type {
  LibraryFilterOption,
  LibraryViewMode,
} from "./components/library/types";
import { ReaderPanel } from "./components/ReaderPanel";
import { ReaderAudioPlayer } from "./components/reader/ReaderAudioPlayer";
import { BookDetailDialog } from "./components/library/BookDetailDialog";
import { ConvertToAudiobookDialog } from "./components/library/ConvertToAudiobookDialog";
import { ConversionProgressDialog } from "./components/library/ConversionProgressDialog";
import type { ConversionProgress } from "./lib/audiobook-converter";
import { Toaster } from "./components/ui/sonner";
import { LoadingScreen } from "./components/app/LoadingScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { usePersistentLibrary } from "./hooks/usePersistentLibrary";
import { usePersistentSettings } from "./hooks/usePersistentSettings";
import type { ReaderPreferences } from "./types/reader";
import type { UITheme } from "./types/ui";
import type {
  AudioProgressSnapshot,
  ChapterProgressSnapshot,
  ChapterSelectionOptions,
} from "./components/reader/types";
import { cn, getLibraryBookStatus } from "./lib/utils";
import { animPatterns, viewTransition } from "./lib/animations";
import { findChaptersForAudioTrack } from "./lib/epub";
import { convertEpubToAudiobook } from "./lib/audiobook-converter";
import { getEpub } from "./lib/epub-store";
import type { VoiceId } from "./types/reader";
import type { Book } from "./types/reader";
import { isIOS } from "./lib/is-tauri";

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: "system",
  fontFamily: "merriweather",
  contentPadding: "comfortable",
  fontSize: "medium",
};

const PROGRESS_LOG_PREFIX = "[ReaderProgress]";

type AppView = "library" | "reader" | "settings";

function App() {
  const {
    library,
    setLibrary,
    isHydrated,
    isImporting,
    importFromDialog,
    handleWebFileSelection,
    ingestEpub,
  } = usePersistentLibrary();

  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [pendingBookForConversion, setPendingBookForConversion] = useState<{
    book: Book;
    buffer: ArrayBuffer;
  } | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState<ConversionProgress | null>(null);
  const [bookConversionProgress, setBookConversionProgress] = useState<Record<string, ConversionProgress>>({});
  const conversionAbortControllerRef = useRef<AbortController | null>(null);
  const convertingBookIdRef = useRef<string | null>(null);

  const handleConvertToAudiobook = useCallback(async (voiceId: VoiceId) => {
    if (!pendingBookForConversion || isConverting) return;
    
    // Create abort controller for this conversion
    const abortController = new AbortController();
    conversionAbortControllerRef.current = abortController;
    convertingBookIdRef.current = pendingBookForConversion.book.id;
    
    setIsConverting(true);
    setShowConvertDialog(false);
    setConversionProgress(null);
    const bookId = pendingBookForConversion.book.id;
    
    try {
      const { book, buffer } = pendingBookForConversion;
      
      // Convert EPUB to audiobook
      const convertedBuffer = await convertEpubToAudiobook(buffer, book.chapters, {
        voiceId,
        signal: abortController.signal,
        onProgress: (progress) => {
          setConversionProgress(progress);
          setBookConversionProgress((prev) => ({
            ...prev,
            [bookId]: progress,
          }));
        },
      });
      
      if (!convertedBuffer || convertedBuffer.byteLength === 0) {
        throw new Error("Conversion produced an empty buffer");
      }
      
      // Determine the new sourcePath for the converted audiobook
      const newSourcePath = book.sourcePath.replace(/\.epub$/, "-audiobook.epub");
      
      // Store converted EPUB buffer in Tauri store (using the new sourcePath)
      try {
        const { storeConvertedEpub } = await import("./lib/epub-store");
        console.debug("Storing converted EPUB", {
          sourcePath: newSourcePath,
          bufferSize: convertedBuffer.byteLength,
        });
        await storeConvertedEpub(newSourcePath, convertedBuffer);
        console.debug("Successfully stored converted EPUB to cache");
      } catch (storeError) {
        console.error("Failed to store converted EPUB to cache", {
          error: storeError,
          sourcePath: newSourcePath,
          bufferSize: convertedBuffer.byteLength,
        });
        // Don't fail the conversion if storage fails - the EPUB is still valid
        // But warn the user that export might not work
        toast.warning("Conversion complete, but caching failed", {
          description: storeError instanceof Error 
            ? `The audiobook was created but caching failed: ${storeError.message}. Export may not work.`
            : "The audiobook was created but may not be exportable. The conversion completed successfully.",
        });
      }
      
      // Remove the original book from library
      setLibrary((prev) => prev.filter((b) => b.id !== book.id));
      
      // Re-ingest the converted EPUB
      await ingestEpub({
        buffer: convertedBuffer,
        sourcePath: newSourcePath,
        fallbackTitle: book.title,
        progress: book.progress,
        pageCountHint: book.pageCount,
      });
      
      setPendingBookForConversion(null);
      setConversionProgress(null);
      setBookConversionProgress((prev) => {
        const next = { ...prev };
        delete next[bookId];
        return next;
      });
      toast.success("Audiobook ready!", {
        description: "Your ebook has been converted to an audiobook.",
      });
    } catch (error) {
      // Don't show error toast if conversion was cancelled
      if (error instanceof Error && error.message === "Conversion cancelled") {
        console.log("Conversion cancelled by user");
      } else {
        console.error("Conversion error:", error);
        toast.error("Conversion failed", {
          description: error instanceof Error ? error.message : "An error occurred during conversion",
        });
      }
      setConversionProgress(null);
      setBookConversionProgress((prev) => {
        const next = { ...prev };
        delete next[bookId];
        return next;
      });
    } finally {
      setIsConverting(false);
      conversionAbortControllerRef.current = null;
      convertingBookIdRef.current = null;
    }
  }, [pendingBookForConversion, isConverting, setLibrary, ingestEpub]);

  const handleConvertBookFromDetail = useCallback(async (book: Book, voiceId: VoiceId) => {
    if (book.audioTracks.length > 0) return;
    
    // Show warning if already converting
    if (isConverting) {
      toast.warning("Conversion in progress", {
        description: "Please wait for the current conversion to complete before starting another one.",
      });
      return;
    }
    
    // Create abort controller for this conversion
    const abortController = new AbortController();
    conversionAbortControllerRef.current = abortController;
    convertingBookIdRef.current = book.id;
    
    setIsConverting(true);
    setConversionProgress(null);
    const bookId = book.id;
    
    try {
      // Load the EPUB file buffer
      let buffer: ArrayBuffer | null = null;
      
      if (book.sourcePath.startsWith("web://")) {
        // Web file - we can't reload it, show error
        toast.error("Cannot convert web files", {
          description: "Please re-import the file to convert it.",
        });
        setIsConverting(false);
        conversionAbortControllerRef.current = null;
        convertingBookIdRef.current = null;
        return;
      }
      
      // Tauri environment - read from store
      buffer = await getEpub(book.sourcePath);
      if (!buffer) {
        throw new Error(`EPUB not found in store: ${book.sourcePath}`);
      }
      
      // Convert EPUB to audiobook
      console.debug("Starting EPUB conversion", {
        sourcePath: book.sourcePath,
        chaptersCount: book.chapters.length,
        voiceId,
      });
      
      let convertedBuffer: ArrayBuffer;
      try {
        convertedBuffer = await convertEpubToAudiobook(buffer, book.chapters, {
          voiceId,
          signal: abortController.signal,
          onProgress: (progress) => {
            setConversionProgress(progress);
            setBookConversionProgress((prev) => ({
              ...prev,
              [bookId]: progress,
            }));
          },
        });
      } catch (conversionError) {
        console.error("EPUB conversion failed", conversionError);
        throw conversionError; // Re-throw to be caught by outer catch
      }
      
      console.debug("Conversion completed, buffer received", {
        sourcePath: book.sourcePath,
        bufferSize: convertedBuffer.byteLength,
        bufferSizeMB: (convertedBuffer.byteLength / (1024 * 1024)).toFixed(2),
        bufferIsValid: convertedBuffer && convertedBuffer.byteLength > 0,
      });
      
      if (!convertedBuffer || convertedBuffer.byteLength === 0) {
        throw new Error("Conversion produced an empty buffer");
      }
      
      // Store converted EPUB buffer in Tauri store (keyed by sourcePath for stability)
      console.debug("About to store converted EPUB", {
        sourcePath: book.sourcePath,
        bufferSize: convertedBuffer.byteLength,
        bufferSizeMB: (convertedBuffer.byteLength / (1024 * 1024)).toFixed(2),
      });
      
      try {
        const { storeConvertedEpub } = await import("./lib/epub-store");
        console.debug("Import successful, calling storeConvertedEpub", {
          sourcePath: book.sourcePath,
        });
        await storeConvertedEpub(book.sourcePath, convertedBuffer);
        console.debug("Successfully stored converted EPUB to cache");
      } catch (storeError) {
        console.error("Failed to store converted EPUB to cache", {
          error: storeError,
          sourcePath: book.sourcePath,
          bufferSize: convertedBuffer.byteLength,
          errorMessage: storeError instanceof Error ? storeError.message : String(storeError),
          errorStack: storeError instanceof Error ? storeError.stack : undefined,
        });
        // Don't fail the conversion if storage fails - the EPUB is still valid
        // But warn the user that export might not work
        toast.warning("Conversion complete, but caching failed", {
          description: storeError instanceof Error 
            ? `The audiobook was created but caching failed: ${storeError.message}. Export may not work.`
            : "The audiobook was created but may not be exportable. The conversion completed successfully.",
        });
      }
      
      // Update the book in place instead of removing and re-adding
      // Re-ingest to update audio tracks and other metadata
      await ingestEpub({
        buffer: convertedBuffer,
        sourcePath: book.sourcePath, // Keep same path - convert in place
        fallbackTitle: book.title,
        progress: book.progress,
        pageCountHint: book.pageCount,
      });
      
      // The book will be updated in the library by ingestEpub
      
      setConversionProgress(null);
      setBookConversionProgress((prev) => {
        const next = { ...prev };
        delete next[bookId];
        return next;
      });
      toast.success("Audiobook ready!", {
        description: "Your ebook has been converted to an audiobook.",
      });
    } catch (error) {
      // Don't show error toast if conversion was cancelled
      if (error instanceof Error && error.message === "Conversion cancelled") {
        console.log("Conversion cancelled by user");
      } else {
        console.error("Conversion error:", error);
        toast.error("Conversion failed", {
          description: error instanceof Error ? error.message : "An error occurred during conversion",
        });
      }
      setConversionProgress(null);
      setBookConversionProgress((prev) => {
        const next = { ...prev };
        delete next[bookId];
        return next;
      });
    } finally {
      setIsConverting(false);
      conversionAbortControllerRef.current = null;
      convertingBookIdRef.current = null;
    }
  }, [isConverting, setLibrary, ingestEpub]);

  const [activeBookId, setActiveBookId] = useState<string | undefined>();
  const [activeChapterId, setActiveChapterId] = useState<string | undefined>();
  const [activeView, setActiveView] = useState<AppView>("library");
  const [librarySearchTerm, setLibrarySearchTerm] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilterOption>("all");
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("grid");
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    DEFAULT_READER_PREFERENCES,
  );
  const [pendingFragment, setPendingFragment] = useState<string | null>(null);
  const [detailBookId, setDetailBookId] = useState<string | null>(null);
  const [isReaderChromeVisible, setIsReaderChromeVisible] = useState(true);
  const [isAudioPlayerOpen, setIsAudioPlayerOpen] = useState(false);
  const [isAudioPlayerDismissing, setIsAudioPlayerDismissing] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState<number | undefined>(undefined);
  const [currentAudioTrackHref, setCurrentAudioTrackHref] = useState<string | undefined>(undefined);
  const [isAudioRestoring, setIsAudioRestoring] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const manualSelectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const manualChapterSelectionRef = useRef<{ chapterId: string; timestamp: number } | null>(null);
  const previousAutoScrollEnabledRef = useRef<boolean | null>(null);
  const explicitlyDisabledRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastAudioBookIdRef = useRef<string | null>(null);
  const rebuildingSyncMapRef = useRef<Set<string>>(new Set());
  const previousViewRef = useRef<AppView>(activeView);
  const {
    settings,
    updateSettings,
    isHydrated: isSettingsHydrated,
  } = usePersistentSettings();
  const uiTheme = settings.theme;

  // Load auto-scroll setting from persistent settings
  useEffect(() => {
    if (isSettingsHydrated && settings.autoScrollEnabled !== undefined) {
      setAutoScrollEnabled(settings.autoScrollEnabled);
    }
  }, [isSettingsHydrated, settings.autoScrollEnabled]);

  useEffect(() => {
    if (activeView !== "reader") {
      setIsReaderChromeVisible(true);
    }
  }, [activeView]);

  const resolveTheme = useCallback((theme: UITheme) => {
    if (theme === "system") {
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        return "dark" as const;
      }
      return "light" as const;
    }
    return theme;
  }, []);

  const resolvedUiTheme = useMemo(
    () => resolveTheme(uiTheme),
    [uiTheme, resolveTheme],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const applyTheme = (theme: UITheme) => {
      const resolved = resolveTheme(theme);
      root.classList.toggle("dark", resolved === "dark");
    };

    applyTheme(uiTheme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ui-theme", uiTheme);
    }

    if (uiTheme !== "system" || typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [uiTheme, resolveTheme]);

  const activeBook = useMemo(() => {
    if (!activeBookId) return undefined;
    return library.find((book) => book.id === activeBookId);
  }, [library, activeBookId]);

  const activeChapter = useMemo(() => {
    if (!activeBook || !activeChapterId) return undefined;
    return activeBook.chapters.find((chapter) => chapter.id === activeChapterId);
  }, [activeBook, activeChapterId]);

  const audioTrackCount = activeBook?.audioTracks?.length ?? 0;
  const hasAudioTracks = audioTrackCount > 0;

  useEffect(() => {
    if (!activeBook?.id || audioTrackCount === 0) {
      setIsAudioPlayerOpen(false);
      setCurrentAudioTime(undefined);
      setCurrentAudioTrackHref(undefined);
      lastAudioBookIdRef.current = null;
      return;
    }

    // Update lastAudioBookIdRef but don't automatically open audio player
    if (lastAudioBookIdRef.current !== activeBook.id) {
      lastAudioBookIdRef.current = activeBook.id;
      // Don't automatically open audio player - let user open it manually
    }
  }, [activeBook?.id, audioTrackCount]);

  // Rebuild audio sync map if missing when audio player opens
  useEffect(() => {
    if (!activeBook || !hasAudioTracks || activeBook.audioSyncMap) {
      // Clear rebuild flag if sync map is now present
      if (activeBook?.audioSyncMap && rebuildingSyncMapRef.current.has(activeBook.id)) {
        rebuildingSyncMapRef.current.delete(activeBook.id);
      }
      return;
    }

    // Prevent multiple rebuilds for the same book
    if (rebuildingSyncMapRef.current.has(activeBook.id)) {
      return;
    }

    // Book has audio tracks but no sync map - rebuild it
    const rebuildSyncMap = async () => {
      rebuildingSyncMapRef.current.add(activeBook.id);
      try {
        console.log("[App] Rebuilding missing audio sync map for book:", activeBook.id);
        // Get the EPUB buffer
        let buffer: ArrayBuffer | null = null;
        
        // Try to get from store first (for converted audiobooks)
        if (activeBook.audioState) {
          const { getConvertedEpub } = await import("./lib/epub-store");
          buffer = await getConvertedEpub(activeBook.sourcePath);
        }
        
        // If not found in store, try to get from store (should always be there)
        if (!buffer) {
          buffer = await getEpub(activeBook.sourcePath);
          if (!buffer) {
            console.warn("[App] Failed to read EPUB from store for sync map rebuild:", activeBook.sourcePath);
            rebuildingSyncMapRef.current.delete(activeBook.id);
            return;
          }
        }

        // Re-ingest to rebuild sync map
        await ingestEpub({
          buffer,
          sourcePath: activeBook.sourcePath,
          fallbackTitle: activeBook.title,
          progress: activeBook.progress,
          pageCountHint: activeBook.pageCount,
          audioState: activeBook.audioState,
        });
        
        console.log("[App] Successfully rebuilt audio sync map");
        // Don't delete from ref here - let the effect cleanup handle it when sync map is detected
      } catch (error) {
        console.error("[App] Failed to rebuild audio sync map:", error);
        rebuildingSyncMapRef.current.delete(activeBook.id);
      }
    };

    rebuildSyncMap();
  }, [activeBook?.id, hasAudioTracks, activeBook?.audioSyncMap, ingestEpub]);


  useEffect(() => {
    const previousView = previousViewRef.current;
    // Auto-open audio player when switching to reader view if book has audio tracks
    if (activeView === "reader" && previousView !== "reader" && hasAudioTracks) {
      setIsAudioPlayerOpen(true);
    }
    previousViewRef.current = activeView;
  }, [activeView, hasAudioTracks]);

  type ProgressUpdatePayload = {
    chapterId: string;
    scrollTop?: number;
    scrollHeight?: number;
    clientHeight?: number;
    percent?: number;
    elementId?: string | null;
    elementIndex?: number | null;
  };

  const updateBookProgress = useCallback(
    (bookId: string, payload: ProgressUpdatePayload) => {
      if (!payload?.chapterId) return;

      console.debug(`${PROGRESS_LOG_PREFIX} update requested`, { bookId, payload });

      setLibrary((prev) => {
        let updated = false;
        const timestamp = new Date().toISOString();

        const nextLibrary = prev.map((book) => {
          if (book.id !== bookId) {
            return book;
          }

          const chapterIndex = book.chapters.findIndex(
            (chapter) => chapter.id === payload.chapterId,
          );
          if (chapterIndex === -1) {
            return book;
          }

          const chapter = book.chapters[chapterIndex];
          const existingProgress = book.progress;
          const chapterMatchesExisting =
            existingProgress?.currentChapterId === chapter.id &&
            existingProgress.currentChapterIndex === chapterIndex;

          const previousScrollTop =
            typeof existingProgress?.currentChapterScrollTop === "number" &&
            Number.isFinite(existingProgress.currentChapterScrollTop)
              ? Math.max(existingProgress.currentChapterScrollTop, 0)
              : 0;
          const previousScrollHeight =
            typeof existingProgress?.currentChapterScrollHeight === "number" &&
            Number.isFinite(existingProgress.currentChapterScrollHeight)
              ? Math.max(existingProgress.currentChapterScrollHeight, 0)
              : 0;
          const previousClientHeight =
            typeof existingProgress?.currentChapterClientHeight === "number" &&
            Number.isFinite(existingProgress.currentChapterClientHeight)
              ? Math.max(existingProgress.currentChapterClientHeight, 0)
              : 0;
          const previousPercent =
            typeof existingProgress?.chapterProgressPercent === "number" &&
            Number.isFinite(existingProgress.chapterProgressPercent)
              ? existingProgress.chapterProgressPercent
              : 0;

          const previousElementId =
            typeof existingProgress?.currentChapterElementId === "string" &&
            existingProgress.currentChapterElementId.length > 0
              ? existingProgress.currentChapterElementId
              : null;
          const previousElementIndex =
            typeof existingProgress?.currentChapterElementIndex === "number" &&
            Number.isFinite(existingProgress.currentChapterElementIndex)
              ? Math.max(Math.round(existingProgress.currentChapterElementIndex), 0)
              : null;

          const resolvedScrollTop =
            typeof payload.scrollTop === "number" && Number.isFinite(payload.scrollTop)
              ? Math.max(payload.scrollTop, 0)
              : chapterMatchesExisting
                ? previousScrollTop
                : 0;

          const resolvedScrollHeight =
            typeof payload.scrollHeight === "number" && Number.isFinite(payload.scrollHeight)
              ? Math.max(payload.scrollHeight, 0)
              : chapterMatchesExisting
                ? previousScrollHeight
                : 0;

          const resolvedClientHeight =
            typeof payload.clientHeight === "number" && Number.isFinite(payload.clientHeight)
              ? Math.max(payload.clientHeight, 0)
              : chapterMatchesExisting
                ? previousClientHeight
                : 0;

          const percentSource =
            typeof payload.percent === "number" && Number.isFinite(payload.percent)
              ? payload.percent
              : chapterMatchesExisting
                ? previousPercent
                : 0;

          const percent = Number(Math.min(Math.max(percentSource ?? 0, 0), 1).toFixed(4));

          const resolvedElementId =
            payload.elementId === undefined
              ? (chapterMatchesExisting ? previousElementId : null)
              : payload.elementId && payload.elementId.length > 0
                ? payload.elementId
                : null;

          let resolvedElementIndex: number | null = null;
          if (payload.elementIndex === undefined) {
            resolvedElementIndex = chapterMatchesExisting ? previousElementIndex : null;
          } else if (payload.elementIndex === null) {
            resolvedElementIndex = null;
          } else if (typeof payload.elementIndex === "number" && Number.isFinite(payload.elementIndex)) {
            resolvedElementIndex = Math.max(Math.round(payload.elementIndex), 0);
          } else if (chapterMatchesExisting) {
            resolvedElementIndex = previousElementIndex;
          }

          const nextProgress = {
            currentChapterId: chapter.id,
            currentChapterHref: chapter.href,
            currentChapterIndex: chapterIndex,
            currentChapterElementId: resolvedElementId ?? null,
            currentChapterElementIndex: resolvedElementIndex ?? null,
            currentChapterScrollTop: resolvedScrollTop,
            currentChapterScrollHeight: resolvedScrollHeight,
            currentChapterClientHeight: resolvedClientHeight,
            chapterProgressPercent: percent,
            updatedAt: timestamp,
          };

          const isUnchanged =
            existingProgress &&
            existingProgress.currentChapterId === nextProgress.currentChapterId &&
            existingProgress.currentChapterIndex === nextProgress.currentChapterIndex &&
            Math.abs(
              (typeof existingProgress.currentChapterScrollTop === "number"
                ? existingProgress.currentChapterScrollTop
                : 0) - nextProgress.currentChapterScrollTop,
            ) < 1 &&
            Math.abs(
              (typeof existingProgress.currentChapterScrollHeight === "number"
                ? existingProgress.currentChapterScrollHeight
                : 0) - nextProgress.currentChapterScrollHeight,
            ) < 1 &&
            Math.abs(
              (typeof existingProgress.currentChapterClientHeight === "number"
                ? existingProgress.currentChapterClientHeight
                : 0) - nextProgress.currentChapterClientHeight,
            ) < 1 &&
            Math.abs(existingProgress.chapterProgressPercent - nextProgress.chapterProgressPercent) <
              0.002 &&
            ((existingProgress.currentChapterElementId ?? null) ===
              (nextProgress.currentChapterElementId ?? null)) &&
            ((existingProgress.currentChapterElementIndex ?? null) ===
              (nextProgress.currentChapterElementIndex ?? null));

          if (isUnchanged) {
            console.debug(`${PROGRESS_LOG_PREFIX} unchanged progress, skipping persist`, {
              bookId,
              chapterId: chapter.id,
            });
            return book;
          }

          updated = true;
          console.debug(`${PROGRESS_LOG_PREFIX} persisting progress`, {
            bookId,
            chapterId: chapter.id,
            progress: nextProgress,
          });
          return {
            ...book,
            progress: nextProgress,
          };
        });

        return updated ? nextLibrary : prev;
      });
    },
    [setLibrary],
  );

  const updateBookAudioState = useCallback(
    (bookId: string, snapshot: AudioProgressSnapshot) => {
      if (!bookId) {
        return;
      }
      if (
        typeof snapshot?.currentTimeSeconds !== "number" ||
        !Number.isFinite(snapshot.currentTimeSeconds) ||
        snapshot.currentTimeSeconds < 0
      ) {
        return;
      }

      setLibrary((prev) => {
        let updated = false;
        const timestamp = snapshot.updatedAt ?? new Date().toISOString();
        const nextLibrary = prev.map((book) => {
          if (book.id !== bookId || !book.audioTracks.length) {
            return book;
          }

          const resolvedTrack =
            book.audioTracks.find((track) => track.id === snapshot.trackId) ??
            book.audioTracks.find((track) => track.href === snapshot.trackHref) ??
            book.audioTracks[snapshot.trackIndex];

          if (!resolvedTrack) {
            return book;
          }

          const resolvedIndex = book.audioTracks.findIndex((track) => track.id === resolvedTrack.id);
          const normalizedSeconds = Number(snapshot.currentTimeSeconds.toFixed(3));
          const existing = book.audioState;

          if (
            existing &&
            existing.currentTrackId === resolvedTrack.id &&
            Math.abs(existing.currentTimeSeconds - normalizedSeconds) < 0.25
          ) {
            return book;
          }

          updated = true;
          return {
            ...book,
            audioState: {
              currentTrackId: resolvedTrack.id,
              currentTrackHref: resolvedTrack.href,
              currentTrackIndex: resolvedIndex === -1 ? snapshot.trackIndex : resolvedIndex,
              currentTimeSeconds: normalizedSeconds,
              updatedAt: timestamp,
            },
          };
        });

        return updated ? nextLibrary : prev;
      });
    },
    [setLibrary],
  );

  useEffect(() => {
    if (!library.length) {
      setActiveBookId(undefined);
      setActiveChapterId(undefined);
      return;
    }

    if (!activeBookId || !library.some((book) => book.id === activeBookId)) {
      const firstBook = library[0];
      setActiveBookId(firstBook.id);
      let fallbackChapterId =
        firstBook.progress?.currentChapterId ??
        firstBook.chapters[firstBook.progress?.currentChapterIndex ?? 0]?.id ??
        firstBook.chapters[0]?.id;
      if (
        fallbackChapterId &&
        !firstBook.chapters.some((chapter) => chapter.id === fallbackChapterId)
      ) {
        fallbackChapterId = firstBook.chapters[0]?.id;
      }
      setActiveChapterId(fallbackChapterId);
      if (fallbackChapterId) {
        updateBookProgress(firstBook.id, { chapterId: fallbackChapterId });
      }
      return;
    }

    const selectedBook = library.find((book) => book.id === activeBookId);
    if (!selectedBook) {
      setActiveBookId(undefined);
      setActiveChapterId(undefined);
      return;
    }

    const hasActiveChapter = activeChapterId
      ? selectedBook.chapters.some((chapter) => chapter.id === activeChapterId)
      : false;

    if (!hasActiveChapter) {
      let fallbackChapterId =
        selectedBook.progress?.currentChapterId ??
        selectedBook.chapters[selectedBook.progress?.currentChapterIndex ?? 0]?.id ??
        selectedBook.chapters[0]?.id;
      if (
        fallbackChapterId &&
        !selectedBook.chapters.some((chapter) => chapter.id === fallbackChapterId)
      ) {
        fallbackChapterId = selectedBook.chapters[0]?.id;
      }
      setActiveChapterId(fallbackChapterId);
      if (fallbackChapterId) {
        updateBookProgress(selectedBook.id, { chapterId: fallbackChapterId });
      }
    }
  }, [library, activeBookId, activeChapterId, updateBookProgress]);

  const updateReaderPreferences = useCallback(
    (update: Partial<ReaderPreferences>) => {
      setReaderPreferences((prev) => ({
        ...prev,
        ...update,
      }));
    },
    [],
  );

  const handleFragmentConsumed = useCallback(() => {
    setPendingFragment(null);
  }, []);

  const handleSelectBook = useCallback(
    (bookId: string) => {
      const selectedBook = library.find((book) => book.id === bookId);
      setActiveBookId(bookId);
      console.debug(`${PROGRESS_LOG_PREFIX} select book`, { bookId });
      let progressChapterId: string | undefined;
      if (selectedBook?.progress?.currentChapterId) {
        const candidate = selectedBook.progress.currentChapterId;
        if (selectedBook.chapters.some((chapter) => chapter.id === candidate)) {
          progressChapterId = candidate;
        }
      }
      const indexFallbackId =
        selectedBook?.chapters[selectedBook.progress?.currentChapterIndex ?? 0]?.id;
      const nextChapterId = progressChapterId ?? indexFallbackId ?? selectedBook?.chapters[0]?.id;
      setActiveChapterId(nextChapterId);
      if (nextChapterId) {
        updateBookProgress(bookId, { chapterId: nextChapterId });
      }
      setPendingFragment(null);
      setActiveView("reader");
    },
    [library, updateBookProgress],
  );

  const handleSelectChapter = useCallback(
    (chapterId: string, options?: ChapterSelectionOptions) => {
      if (!activeBookId) return;

      // If this is a manual selection (e.g., from TOC), track it and disable auto-scroll
      if (options?.isManualSelection) {
        console.log("[Chapter Selection] Manual chapter selection detected:", {
          chapterId,
          currentAutoScrollEnabled: autoScrollEnabled,
        });
        
        // Track manual selection FIRST to prevent auto-switch from overriding it
        // Always update the ref, even if it was already set, to allow selecting different chapters
        manualChapterSelectionRef.current = {
          chapterId,
          timestamp: Date.now(),
        };
        
        // Disable auto-scroll if it's currently enabled (don't re-enable automatically)
        // This allows manual chapter selection to work regardless of auto-scroll state
        if (autoScrollEnabled) {
          console.log("[Chapter Selection] Disabling auto-scroll due to manual selection");
          setAutoScrollEnabled(false);
          // Persist the setting so it remains disabled
          updateSettings({ autoScrollEnabled: false });
        }
        
        // Clear any existing timeout that would re-enable auto-scroll
        if (manualSelectionTimeoutRef.current) {
          clearTimeout(manualSelectionTimeoutRef.current);
          manualSelectionTimeoutRef.current = null;
        }
      }

      setActiveChapterId(chapterId);

      const requestedScrollPosition = options?.scrollPosition ?? "maintain";
      const progressUpdate: ProgressUpdatePayload = { chapterId };

      if (requestedScrollPosition === "top") {
        progressUpdate.scrollTop = 0;
        progressUpdate.scrollHeight = 0;
        progressUpdate.clientHeight = 0;
        progressUpdate.percent = 0;
      } else if (requestedScrollPosition === "bottom") {
        progressUpdate.percent = 1;
      }

      console.debug(`${PROGRESS_LOG_PREFIX} select chapter`, {
        bookId: activeBookId,
        chapterId,
        requestedScrollPosition,
        progressUpdate,
        isManualSelection: options?.isManualSelection,
      });

      updateBookProgress(activeBookId, progressUpdate);

      const fragment = options?.fragment;
      setPendingFragment(fragment && fragment.length > 0 ? fragment.replace(/^#/, "") : null);
      setActiveView("reader");
    },
    [activeBookId, updateBookProgress, autoScrollEnabled, updateSettings],
  );

  const handleChapterProgress = useCallback(
    (bookId: string, snapshot: ChapterProgressSnapshot) => {
      console.debug(`${PROGRESS_LOG_PREFIX} received progress snapshot`, { bookId, snapshot });
      updateBookProgress(bookId, {
        chapterId: snapshot.chapterId,
        scrollTop: snapshot.scrollTop,
        scrollHeight: snapshot.scrollHeight,
        clientHeight: snapshot.clientHeight,
        percent: snapshot.percent,
        elementId: snapshot.activeElementId,
        elementIndex: snapshot.activeElementIndex,
      });
    },
    [updateBookProgress],
  );

  // Auto-switch chapter when audio track changes
  useEffect(() => {
    if (!activeBook || !currentAudioTrackHref || !activeBook.audioSyncMap) {
      return;
    }

    // Don't auto-switch if auto-scroll is disabled
    if (!autoScrollEnabled) {
      console.log("[Auto-Chapter] Skipping auto-switch because auto-scroll is disabled");
      return;
    }

    // Don't auto-switch if there was a recent manual chapter selection
    if (manualChapterSelectionRef.current) {
      const timeSinceManualSelection = Date.now() - manualChapterSelectionRef.current.timestamp;
      const isRecentManualSelection = timeSinceManualSelection < 10000; // Increased to 10 seconds
      const isCurrentChapterManuallySelected = 
        manualChapterSelectionRef.current.chapterId === activeChapterId;
      
      // Prevent auto-switch if:
      // 1. Manual selection was recent (within 10 seconds), OR
      // 2. Current chapter is the one that was manually selected (regardless of time)
      if (isRecentManualSelection || isCurrentChapterManuallySelected) {
        console.log("[Auto-Chapter] Skipping auto-switch due to manual selection:", {
          manualChapterId: manualChapterSelectionRef.current.chapterId,
          currentChapterId: activeChapterId,
          timeSinceSelection: timeSinceManualSelection,
          isRecentManualSelection,
          isCurrentChapterManuallySelected,
        });
        return;
      }
      
      // If manual selection was older than 10 seconds and current chapter doesn't match,
      // clear the ref to allow auto-switch again
      if (!isRecentManualSelection && !isCurrentChapterManuallySelected) {
        console.log("[Auto-Chapter] Clearing old manual selection ref, allowing auto-switch");
        manualChapterSelectionRef.current = null;
      }
    }

    const chaptersForTrack = findChaptersForAudioTrack(
      activeBook.audioSyncMap,
      currentAudioTrackHref,
    );

    if (chaptersForTrack.length === 0) {
      return;
    }

    // Find the first chapter that matches one of the chapter hrefs for this track
    const matchingChapter = activeBook.chapters.find((chapter) => {
      const chapterHref = chapter.href.split("#")[0];
      return chaptersForTrack.includes(chapterHref);
    });

    if (matchingChapter && matchingChapter.id !== activeChapterId) {
      console.log("[Auto-Chapter] Switching to chapter for audio track:", {
        trackHref: currentAudioTrackHref,
        chapterId: matchingChapter.id,
        chapterTitle: matchingChapter.title,
        chapterHref: matchingChapter.href,
      });
      // Note: isManualSelection is NOT set here, so auto-scroll remains enabled
      handleSelectChapter(matchingChapter.id, {
        scrollPosition: "top",
      });
    }
  }, [activeBook, currentAudioTrackHref, activeChapterId, autoScrollEnabled, handleSelectChapter]);

  // Helper function to find and switch to chapter matching current audio track
  const switchToMatchingChapter = useCallback(() => {
    if (!activeBook || !currentAudioTrackHref || !activeBook.audioSyncMap) {
      return;
    }

    const chaptersForTrack = findChaptersForAudioTrack(
      activeBook.audioSyncMap,
      currentAudioTrackHref,
    );

    if (chaptersForTrack.length === 0) {
      return;
    }

    // Find the first chapter that matches one of the chapter hrefs for this track
    const matchingChapter = activeBook.chapters.find((chapter) => {
      const chapterHref = chapter.href.split("#")[0];
      return chaptersForTrack.includes(chapterHref);
    });

    if (matchingChapter && matchingChapter.id !== activeChapterId) {
      console.log("[Auto-Scroll] Re-enabling auto-scroll, switching to matching chapter:", {
        trackHref: currentAudioTrackHref,
        chapterId: matchingChapter.id,
        chapterTitle: matchingChapter.title,
        currentChapterId: activeChapterId,
      });
      handleSelectChapter(matchingChapter.id, {
        scrollPosition: "top",
      });
    }
  }, [activeBook, currentAudioTrackHref, activeChapterId, handleSelectChapter]);

  // Wrapper function to handle explicit user toggles
  const handleAutoScrollToggle = useCallback((enabled: boolean) => {
    setAutoScrollEnabled(enabled);
    
    // Persist the setting
    updateSettings({ autoScrollEnabled: enabled });
    
    // Track if user explicitly disabled it
    if (!enabled) {
      explicitlyDisabledRef.current = true;
      // Clear any pending re-enable timeout from manual selection
      if (manualSelectionTimeoutRef.current) {
        clearTimeout(manualSelectionTimeoutRef.current);
        manualSelectionTimeoutRef.current = null;
      }
    } else {
      // User explicitly enabled it, clear the explicit disable flag
      explicitlyDisabledRef.current = false;
      
      // Clear manual selection ref to allow auto-switch again
      if (manualChapterSelectionRef.current) {
        console.log("[Auto-Scroll] Clearing manual selection ref, allowing auto-switch");
        manualChapterSelectionRef.current = null;
      }
      
      // If current chapter doesn't match audio track, switch to matching chapter
      // Use setTimeout to ensure state update has completed
      setTimeout(() => {
        switchToMatchingChapter();
      }, 0);
    }
  }, [switchToMatchingChapter, updateSettings]);

  // Show toast when auto-scroll state changes
  useEffect(() => {
    // Skip on initial mount
    if (previousAutoScrollEnabledRef.current === null) {
      previousAutoScrollEnabledRef.current = autoScrollEnabled;
      return;
    }

    // Only show toast if state actually changed
    if (previousAutoScrollEnabledRef.current !== autoScrollEnabled) {
      if (autoScrollEnabled) {
        toast.success("Auto-scroll enabled", {
          description: "The page will automatically scroll to follow the audio",
          duration: 2000,
        });
      } else {
        toast.info("Auto-scroll disabled", {
          description: "The page will no longer automatically scroll",
          duration: 2000,
        });
      }
      previousAutoScrollEnabledRef.current = autoScrollEnabled;
    }
  }, [autoScrollEnabled]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (manualSelectionTimeoutRef.current) {
        clearTimeout(manualSelectionTimeoutRef.current);
      }
    };
  }, []);

  const handleAddEbook = useCallback(async () => {
    if (isImporting) return;
    
    const result = await importFromDialog();
    if (!result) {
      fileInputRef.current?.click();
      return;
    }
    
    // Check if result contains book info (for conversion check)
    if (typeof result === "object" && "book" in result && "buffer" in result) {
      const { book, buffer } = result;
      // Check if book needs conversion (no audio tracks)
      if (book.audioTracks.length === 0) {
        // Only show conversion dialog if not already converting
        if (!isConverting) {
          setPendingBookForConversion({ book, buffer });
          setShowConvertDialog(true);
        } else {
          // Book is imported, but conversion dialog is skipped while another conversion is in progress
          toast.info("Ebook imported", {
            description: "You can convert it to an audiobook after the current conversion completes.",
          });
        }
      }
    }
  }, [importFromDialog, isImporting, isConverting]);

  const handleDeleteBook = useCallback(async (bookId: string) => {
      // If this book is currently being converted, cancel the conversion
      if (convertingBookIdRef.current === bookId && conversionAbortControllerRef.current) {
        conversionAbortControllerRef.current.abort();
        conversionAbortControllerRef.current = null;
        convertingBookIdRef.current = null;
        setIsConverting(false);
        setConversionProgress(null);
        setBookConversionProgress((prev) => {
          const next = { ...prev };
          delete next[bookId];
          return next;
        });
        // If it was pending conversion, clear that too
        if (pendingBookForConversion?.book.id === bookId) {
          setPendingBookForConversion(null);
          setShowConvertDialog(false);
        }
        toast.info("Conversion cancelled", {
          description: "The conversion has been cancelled and the book has been removed.",
        });
      }
      
      setLibrary((prev) => prev.filter((book) => book.id !== bookId));
      setDetailBookId(null);

      // Clean up stored converted EPUB if it exists
      // Find the book first to get its sourcePath
      const bookToDelete = library.find((book) => book.id === bookId);
      if (bookToDelete) {
        try {
          const { removeConvertedEpub } = await import("./lib/epub-store");
          await removeConvertedEpub(bookToDelete.sourcePath);
        } catch (error) {
          console.warn("Failed to remove stored EPUB:", error);
        }
      }

      if (activeBookId === bookId) {
        setActiveBookId(undefined);
        setActiveChapterId(undefined);
        setPendingFragment(null);
        setActiveView("library");
      }
    },
    [activeBookId, setLibrary, pendingBookForConversion],
  );

  useEffect(() => {
    if (!library.length) {
      setActiveView("library");
    }
  }, [library.length]);

  const normalizedLibrarySearch = librarySearchTerm.trim().toLowerCase();
  const searchFilteredLibrary = useMemo(() => {
    if (!normalizedLibrarySearch) return library;
    return library.filter((book) => {
      const haystack = `${book.title} ${book.author}`.toLowerCase();
      return haystack.includes(normalizedLibrarySearch);
    });
  }, [library, normalizedLibrarySearch]);

  const filteredLibrary = useMemo(() => {
    switch (libraryFilter) {
      case "new":
        return searchFilteredLibrary.filter((book) => getLibraryBookStatus(book) === "new");
      case "resume":
        return searchFilteredLibrary.filter(
          (book) => getLibraryBookStatus(book) === "resume",
        );
      case "finished":
        return searchFilteredLibrary.filter(
          (book) => getLibraryBookStatus(book) === "finished",
        );
      case "recent":
        return [...searchFilteredLibrary].reverse();
      case "author":
        return [...searchFilteredLibrary].sort((a, b) =>
          a.author.localeCompare(b.author, undefined, { sensitivity: "base" }),
        );
      default:
        return searchFilteredLibrary;
    }
  }, [searchFilteredLibrary, libraryFilter]);

  const showAudioPlayer = hasAudioTracks && (isAudioPlayerOpen || isAudioPlayerDismissing);
  const audioPlayerChromeVisible = activeView === "reader" ? isReaderChromeVisible : true;

  const handleAudioPlayerClose = useCallback(() => {
    setIsAudioPlayerDismissing(true);
    // Wait for exit animation to complete before hiding
    // Audio progress is saved in handleDismiss, scroll progress is saved in ReaderViewport effect
    setTimeout(() => {
      setIsAudioPlayerOpen(false);
      setIsAudioPlayerDismissing(false);
    }, 300);
  }, []);

  const libraryView = (
    <LibraryPanel
      library={filteredLibrary}
      totalBooks={library.length}
      searchTerm={librarySearchTerm}
      onSearchChange={setLibrarySearchTerm}
      activeFilter={libraryFilter}
      onFilterChange={setLibraryFilter}
      viewMode={libraryViewMode}
      onViewModeChange={setLibraryViewMode}
      activeBookId={activeBookId}
      isImporting={isImporting}
      onAddEbook={handleAddEbook}
      onOpenBook={handleSelectBook}
      onViewDetails={(bookId) => setDetailBookId(bookId)}
      bookConversionProgress={bookConversionProgress}
    />
  );

  const readerView = (
    <ReaderPanel
      activeBook={activeBook}
      activeChapter={activeChapter}
      preferences={readerPreferences}
      onPreferencesChange={updateReaderPreferences}
      onSelectChapter={handleSelectChapter}
      pendingFragment={pendingFragment}
      onFragmentConsumed={handleFragmentConsumed}
      onNavigateLibrary={() => setActiveView("library")}
      resolvedUiTheme={resolvedUiTheme}
      onChapterProgress={handleChapterProgress}
      onChromeVisibilityChange={setIsReaderChromeVisible}
      audioPlayerVisible={Boolean(activeBook?.audioTracks?.length) && isAudioPlayerOpen}
      onOpenAudioPlayer={() => setIsAudioPlayerOpen(true)}
      currentAudioTime={currentAudioTime}
      currentAudioTrackHref={currentAudioTrackHref}
      autoScrollEnabled={autoScrollEnabled}
      isAudioRestoring={isAudioRestoring}
    />
  );

  const detailBook = useMemo(() => {
    if (!detailBookId) return undefined;
    return library.find((book) => book.id === detailBookId);
  }, [detailBookId, library]);

  const canOpenReader = Boolean(activeBook);
  const navigationItems: Array<{ id: AppView; label: string; disabled?: boolean }> = [
    { id: "library", label: "Library" },
    { id: "reader", label: "Reader", disabled: !canOpenReader },
    { id: "settings", label: "Settings" },
  ];
  const settingsView = <SettingsPanel settings={settings} onSettingsChange={updateSettings} />;
  const currentView =
    activeView === "settings"
      ? settingsView
      : activeView === "library"
        ? libraryView
        : readerView;
  const hideNavigation = activeView === "reader" && !isReaderChromeVisible;

  if (!isHydrated || !isSettingsHydrated) {
    return <LoadingScreen message="Loading your library…" />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <HiddenFileInput
        ref={fileInputRef}
        accept={isIOS() ? "*/*" : ".epub,application/epub+zip"}
        aria-label="Select an EPUB file to import"
        aria-hidden="true"
        tabIndex={-1}
        onChange={async (e) => {
          const result = await handleWebFileSelection(e);
          if (result && "book" in result && "buffer" in result) {
            const { book, buffer } = result;
            // Check if book needs conversion (no audio tracks)
            if (book.audioTracks.length === 0) {
              setPendingBookForConversion({ book, buffer });
              setShowConvertDialog(true);
            }
          }
        }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8">
        <div 
          className={cn(
            "flex flex-1 min-h-0 flex-col",
            viewTransition(previousViewRef.current, activeView)
          )}
          key={activeView}
        >
          {currentView}
        </div>
      </div>
      {showAudioPlayer && activeBook ? (
        <ReaderAudioPlayer
          bookId={activeBook.id}
          tracks={activeBook.audioTracks}
          bookTitle={activeBook.title}
          initialAudioState={activeBook.audioState}
          onProgress={(snapshot) => {
            updateBookAudioState(activeBook.id, snapshot);
            setCurrentAudioTime(snapshot.currentTimeSeconds);
            setCurrentAudioTrackHref(snapshot.trackHref);
          }}
          chromeVisible={audioPlayerChromeVisible}
          onClose={handleAudioPlayerClose}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollToggle={handleAutoScrollToggle}
          onRestorationStateChange={setIsAudioRestoring}
        />
      ) : null}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6",
          animPatterns.navBar,
          hideNavigation ? "nav-bar-exit" : "nav-bar-enter",
        )}
      >
        <div
          className={cn(
            "pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-lg ring-1 ring-black/5",
            // Enhanced backdrop blur when visible
            hideNavigation ? "backdrop-blur-sm" : "backdrop-blur-xl",
            // Smooth transition for backdrop blur
            "transition-[backdrop-filter] duration-300 ease-in-out",
            hideNavigation && "pointer-events-none",
          )}
        >
          {navigationItems.map((item) => {
            const isActive = activeView === item.id;
            const isDisabled = Boolean(item.disabled);
            return (
              <button
                key={item.id}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) return;
                  setActiveView(item.id);
                }}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium",
                  animPatterns.buttonHover,
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted",
                  isDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
                title={item.id === "reader" && isDisabled ? "Open a book to enter the reader" : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      {detailBook ? (
        <BookDetailDialog
          book={detailBook}
          open
          onClose={() => setDetailBookId(null)}
          onOpenBook={() => {
            setDetailBookId(null);
            handleSelectBook(detailBook.id);
          }}
          onDeleteBook={() => handleDeleteBook(detailBook.id)}
          conversionProgress={bookConversionProgress[detailBook.id]}
          onConvertToAudiobook={handleConvertBookFromDetail}
        />
      ) : null}
      {pendingBookForConversion ? (
        <>
          <ConvertToAudiobookDialog
            open={showConvertDialog && !isConverting}
            onOpenChange={(open) => {
              if (!isConverting) {
                setShowConvertDialog(open);
                if (!open) {
                  setPendingBookForConversion(null);
                }
              }
            }}
            onConfirm={handleConvertToAudiobook}
            bookTitle={pendingBookForConversion.book.title}
          />
          <ConversionProgressDialog
            open={isConverting && convertingBookIdRef.current === pendingBookForConversion.book.id}
            progress={conversionProgress}
            bookTitle={pendingBookForConversion.book.title}
          />
        </>
      ) : null}
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
