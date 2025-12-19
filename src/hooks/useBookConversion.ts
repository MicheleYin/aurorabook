import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { logger } from "../lib/logger";
import { mergeBookAudioFields } from "../lib/book-utils";
import type { Book } from "../types/reader";
import type { VoiceId } from "../types/reader";
import type { ConversionProgress } from "../lib/audiobook-converter";
import { convertEpubToAudiobook } from "../lib/audiobook-converter";
import { readAllBooks, readOneBook } from "../lib/book-service";
import { clearBookCache, clearChapterCache } from "../lib/lazy-chapter-loader";

export type PendingBookForConversion = {
  book: Book;
  buffer: ArrayBuffer;
};

export function useBookConversion(
  library: Book[],
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>,
) {
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [pendingBookForConversion, setPendingBookForConversion] = useState<PendingBookForConversion | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState<ConversionProgress | null>(null);
  const [bookConversionProgress, setBookConversionProgress] = useState<Record<string, ConversionProgress>>({});
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellingBookId, setCancellingBookId] = useState<string | null>(null);
  const conversionAbortControllerRef = useRef<AbortController | null>(null);
  const convertingBookIdRef = useRef<string | null>(null);
  const convertingSourcePathRef = useRef<string | null>(null);
  const conversionStartTimeRef = useRef<number | null>(null);
  const listenerSetupRef = useRef<boolean>(false);
  const libraryRef = useRef<Book[]>(library);
  
  // Keep library ref in sync with current library state
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  // Listen for chapter completion events and conversion cancellation events to refresh the book
  useEffect(() => {
    // Only set up listener once
    if (listenerSetupRef.current) {
      return;
    }
    
    let unlistenChapter: (() => void) | null = null;
    let unlistenCancelled: (() => void) | null = null;

    const setupListeners = async () => {
      try {
        // Listen for chapter completion events
        unlistenChapter = await listen<{
          source_path: string;
          chapter_index: number;
          total_chapters: number;
          chapter_title: string;
          audio_generated: boolean;
        }>("chapter-completed", async (event) => {
          const { source_path, chapter_title, audio_generated, chapter_index } = event.payload;
          
          logger.log("[useBookConversion] 📥 Received chapter-completed event", {
            source_path,
            chapter_index,
            chapter_title,
            audio_generated,
          });
          
          // Fetch the updated book and merge only audio-related fields
          // This preserves the existing book state so audio playback doesn't stop
          try {
            // First, try to find the book in the current library state
            // This avoids an unnecessary readAllBooks() call
            // Use the library ref to get the latest state
            let existingBook = libraryRef.current.find(
              (book) => book.sourcePath === source_path
            );
            
            // If not found in library state, fetch from backend
            // This can happen if the library hasn't been refreshed yet
            if (!existingBook) {
              logger.debug("Book not in library state, fetching from backend", { source_path });
              const allBooks = await readAllBooks();
              existingBook = allBooks.find(
                (book) => book.sourcePath === source_path
              );
            }
            
            if (!existingBook) {
              logger.warn("Book not found in library for source_path:", source_path);
              return;
            }
            
            // Fetch the updated book from backend
            const updatedBook = await readOneBook(existingBook.id);
            
            if (!updatedBook) {
              logger.warn("Failed to fetch updated book:", existingBook.id);
              return;
            }
            
            // Find the completed chapter by index (chapter_index is 1-based in the event)
            // Clear cache for the specific completed chapter to force reload of updated HTML with spans
            const completedChapterIndex = chapter_index - 1; // Convert to 0-based
            let completedChapter: typeof updatedBook.chapters[0] | null = null;
            
            logger.debug("[useBookConversion] Finding completed chapter", {
              chapterIndex: chapter_index,
              completedChapterIndex,
              totalChapters: updatedBook.chapters.length,
            });
            
            if (completedChapterIndex >= 0 && completedChapterIndex < updatedBook.chapters.length) {
              completedChapter = updatedBook.chapters[completedChapterIndex];
              
              logger.log("[useBookConversion] Found completed chapter, clearing cache", {
                sourcePath: source_path,
                chapterIndex: chapter_index,
                chapterId: completedChapter.id,
                chapterHref: completedChapter.href,
                chapterTitle: completedChapter.title,
                hasContentHtml: !!completedChapter.contentHtml,
                contentHtmlSize: completedChapter.contentHtml?.length || 0,
              });
              
              // Clear cache for this specific chapter (tries multiple href variations)
              clearChapterCache(source_path, completedChapter.href);
              
              logger.log("[useBookConversion] ✓ Cleared cache for completed chapter", {
                sourcePath: source_path,
                chapterIndex: chapter_index,
                chapterId: completedChapter.id,
                chapterHref: completedChapter.href,
                chapterTitle: completedChapter.title,
              });
            } else {
              logger.warn("[useBookConversion] ✗ Completed chapter index out of bounds", {
                chapterIndex: chapter_index,
                completedChapterIndex,
                totalChapters: updatedBook.chapters.length,
                sourcePath: source_path,
              });
              // Fallback: clear all chapters for this book if we can't find the specific one
              clearBookCache(source_path);
              logger.log("[useBookConversion] Cleared all chapters cache as fallback", { source_path });
            }
            
            // Merge only audio-related fields into the existing book
            // This preserves all other state including loaded chapters, audio playback state, etc.
            // Note: chapters are included in mergeBookAudioFields, so updated chapter HTML will be available
            logger.debug("[useBookConversion] Updating library state with merged book", {
              bookId: existingBook.id,
              source_path,
              hasCompletedChapter: !!completedChapter,
            });
            
            setLibrary((currentLibrary) => {
              const bookIndex = currentLibrary.findIndex(
                (book) => book.id === existingBook.id || book.sourcePath === source_path
              );
              
              if (bookIndex === -1) {
                // Book not in current library state, add it
                logger.log("[useBookConversion] Book not in library, adding it", { bookId: updatedBook.id });
                return [...currentLibrary, updatedBook];
              }
              
              const currentBook = currentLibrary[bookIndex];
              const mergedBook = mergeBookAudioFields(currentBook, updatedBook);
              
              // Log chapter comparison if we have the completed chapter
              if (completedChapter) {
                const currentChapter = currentBook.chapters.find(ch => ch.id === completedChapter.id);
                const mergedChapter = mergedBook.chapters.find(ch => ch.id === completedChapter.id);
                
                logger.log("[useBookConversion] Merged book data", {
                  bookId: mergedBook.id,
                  chapterId: completedChapter.id,
                  currentChapterHasHtml: !!currentChapter?.contentHtml,
                  currentChapterHtmlSize: currentChapter?.contentHtml?.length || 0,
                  mergedChapterHasHtml: !!mergedChapter?.contentHtml,
                  mergedChapterHtmlSize: mergedChapter?.contentHtml?.length || 0,
                  chaptersCount: mergedBook.chapters.length,
                });
              }
              
              // If the completed chapter exists and is different from the cached version,
              // the library update will trigger a re-render, and since we cleared the cache,
              // the chapter will be automatically refetched when accessed
              
              const updated = [...currentLibrary];
              updated[bookIndex] = mergedBook;
              
              logger.log("[useBookConversion] ✓ Updated library state", {
                bookId: mergedBook.id,
                source_path,
              });
              
              return updated;
            });
            
            // Emit a custom event to notify components that a specific chapter was updated
            // This allows the reader to reload the chapter if it's currently being viewed
            if (completedChapter) {
              try {
                logger.log("[useBookConversion] Emitting chapter-updated event", {
                  bookId: existingBook.id,
                  chapterId: completedChapter.id,
                  chapterHref: completedChapter.href,
                  chapterIndex: chapter_index,
                });
                
                const chapterUpdatedEvent = new CustomEvent("chapter-updated", {
                  detail: {
                    bookId: existingBook.id,
                    sourcePath: source_path,
                    chapterId: completedChapter.id,
                    chapterHref: completedChapter.href,
                    chapterIndex: chapter_index,
                  },
                });
                window.dispatchEvent(chapterUpdatedEvent);
                
                logger.log("[useBookConversion] ✓ Successfully emitted chapter-updated event", {
                  bookId: existingBook.id,
                  chapterId: completedChapter.id,
                  chapterHref: completedChapter.href,
                });
              } catch (error) {
                logger.warn("[useBookConversion] ✗ Failed to emit chapter-updated event", error);
              }
            } else {
              logger.warn("[useBookConversion] No completed chapter, skipping chapter-updated event", {
                source_path,
                chapter_index,
              });
            }
            
            // Show notification that a new chapter is available only if audio was generated
            if (audio_generated) {
              toast.info("New chapter available", {
                description: `"${chapter_title}" has been converted and is ready to play.`,
                duration: 5000,
              });
            }
          } catch (error) {
            logger.warn("Failed to refresh book after chapter completion:", error);
          }
        });
        
        // Listen for conversion cancellation events
        unlistenCancelled = await listen<{
          source_path: string;
        }>("conversion-cancelled", async (event) => {
          const { source_path } = event.payload;
          
          // Fetch the updated book and merge the new info, just like when a chapter is done
          try {
            // First, try to find the book in the current library state
            // This avoids an unnecessary readAllBooks() call
            // Use the library ref to get the latest state
            let existingBook = libraryRef.current.find(
              (book) => book.sourcePath === source_path
            );
            
            // If not found in library state, fetch from backend
            // This can happen if the library hasn't been refreshed yet
            if (!existingBook) {
              logger.debug("Book not in library state, fetching from backend", { source_path });
              const allBooks = await readAllBooks();
              existingBook = allBooks.find(
                (book) => book.sourcePath === source_path
              );
            }
            
            if (!existingBook) {
              logger.warn("Book not found in library for source_path:", source_path);
              return;
            }
            
            // Fetch the updated book from backend
            const updatedBook = await readOneBook(existingBook.id);
            
            if (!updatedBook) {
              logger.warn("Failed to fetch updated book:", existingBook.id);
              return;
            }
            
            // Merge the updated book data into the existing book
            setLibrary((currentLibrary) => {
              const bookIndex = currentLibrary.findIndex(
                (book) => book.id === existingBook.id || book.sourcePath === source_path
              );
              
              if (bookIndex === -1) {
                // Book not in current library state, add it
                return [...currentLibrary, updatedBook];
              }
              
              const currentBook = currentLibrary[bookIndex];
              const mergedBook = mergeBookAudioFields(currentBook, updatedBook);
              
              const updated = [...currentLibrary];
              updated[bookIndex] = mergedBook;
              
              return updated;
            });
            
            // Clear cancelling state and show toast only after receiving the event
            setIsCancelling(false);
            setCancellingBookId(null);
            
            // Clear conversion progress for this book
            setConversionProgress(null);
            setBookConversionProgress((prev) => {
              const next = { ...prev };
              delete next[existingBook.id];
              return next;
            });
            
            // Show toast notification
            toast.info("Conversion cancelled", {
              description: "The conversion has been cancelled.",
            });
          } catch (error) {
            logger.warn("Failed to refresh book after conversion cancellation:", error);
            // Still clear the cancelling state even if refresh failed
            setIsCancelling(false);
            setCancellingBookId(null);
          }
        });
        
        listenerSetupRef.current = true;
      } catch (error) {
        logger.warn("Failed to set up event listeners:", error);
      }
    };

    void setupListeners();

    return () => {
      if (unlistenChapter) {
        unlistenChapter();
      }
      if (unlistenCancelled) {
        unlistenCancelled();
      }
      listenerSetupRef.current = false;
    };
  }, []); // Empty dependency array - only set up once

  // Shared conversion logic used by both handlers
  const performConversion = useCallback(async (book: Book, voiceId: VoiceId, options?: {
    updateBookStateBeforeConversion?: boolean;
    closeDialog?: boolean;
  }) => {
    // Create abort controller for this conversion
    const abortController = new AbortController();
    conversionAbortControllerRef.current = abortController;
    convertingBookIdRef.current = book.id;
    convertingSourcePathRef.current = book.sourcePath;
    
    setIsConverting(true);
    if (options?.closeDialog) {
      setShowConvertDialog(false);
    }
    setConversionProgress({
      currentChapter: 0,
      totalChapters: 0,
      wordsProcessed: 0,
      totalWords: 0,
      wordsInCurrentChapter: 0,
      currentStep: "initializing",
      message: "Starting conversion...",
    });
    
    conversionStartTimeRef.current = Date.now();
    const bookId = book.id;
    let wasCancelled = false;
    
    // Update local book state immediately with voice_id so it's available for resuming (for detail view)
    if (options?.updateBookStateBeforeConversion) {
      setLibrary((prev) => {
        const index = prev.findIndex((b) => b.id === book.id || b.sourcePath === book.sourcePath);
        if (index !== -1) {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            voiceId,
            conversionStatus: "started" as const,
          };
          return updated;
        }
        return prev;
      });
    }
    
    try {
      // Convert EPUB to audiobook - backend loads EPUB from database and handles everything
      logger.debug("Starting EPUB conversion", {
        bookId: book.id,
        sourcePath: book.sourcePath,
        voiceId,
      });
      
      const updatedBook = await convertEpubToAudiobook({
        bookId: book.id,
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
      
      logger.debug("Conversion completed, updating library with returned book data", {
        sourcePath: book.sourcePath,
        hasUpdatedBook: updatedBook !== null,
      });
      
      // Clear book cache to force fresh data from backend
      clearBookCache(book.sourcePath);
      
      // Update library with the returned book data directly
      if (updatedBook) {
        setLibrary((prev) => {
          const index = prev.findIndex((b) => b.id === updatedBook.id || b.sourcePath === updatedBook.sourcePath);
          if (index !== -1) {
            // Replace existing book with updated version
            const updated = [...prev];
            updated[index] = updatedBook;
            return updated;
          } else {
            // Book not found, add it (shouldn't happen, but safe)
            return [...prev, updatedBook];
          }
        });
      }
      
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
      // The cancellation event handler will show the toast and clear cancelling state
      if (error instanceof Error && error.message === "Conversion cancelled") {
        console.log("Conversion cancelled by user");
        wasCancelled = true;
        // Don't clear cancelling state here - wait for the event from backend
      } else {
        logger.error("Conversion error:", error);
        toast.error("Conversion failed", {
          description: error instanceof Error ? error.message : "An error occurred during conversion",
        });
        // Clear cancelling state if conversion failed (not cancelled)
        setIsCancelling(false);
        setCancellingBookId(null);
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
      convertingSourcePathRef.current = null;
      conversionStartTimeRef.current = null;
      // Only clear cancelling state if conversion completed successfully (not cancelled)
      // If cancelled, the event handler will clear it when it receives the event
      if (!wasCancelled && cancellingBookId === bookId) {
        // Conversion completed successfully, clear cancelling state
        setIsCancelling(false);
        setCancellingBookId(null);
      }
    }
  }, [setLibrary, cancellingBookId]);

  const handleConvertToAudiobook = useCallback(async (voiceId: VoiceId) => {
    if (!pendingBookForConversion || isConverting || isCancelling) return;
    
    await performConversion(pendingBookForConversion.book, voiceId, {
      closeDialog: true,
    });
    
    setPendingBookForConversion(null);
  }, [pendingBookForConversion, isConverting, isCancelling, performConversion]);

  const handleConvertBookFromDetail = useCallback(async (book: Book, voiceId: VoiceId) => {
    // Allow conversion if book has started status (for resuming) even if some tracks exist
    const conversionStatus = book.conversionStatus ?? "notStarted";
    if (book.audioTracks.length > 0 && conversionStatus === "notStarted") {
      logger.debug("Skipping conversion - book already has audio tracks and conversion not started");
      return;
    }
    
    // Show warning if already converting or cancelling
    if (isConverting || isCancelling) {
      toast.warning("Conversion in progress", {
        description: isCancelling 
          ? "Please wait for the cancellation to complete before starting a new conversion."
          : "Please wait for the current conversion to complete before starting another one.",
      });
      return;
    }
    
    await performConversion(book, voiceId, {
      updateBookStateBeforeConversion: true,
    });
  }, [isConverting, isCancelling, performConversion]);

  const cancelConversionForBook = useCallback(async (bookId: string) => {
    // Immediately update UI to show "pausing" state
    setIsCancelling(true);
    setCancellingBookId(bookId);
    
    if (convertingBookIdRef.current === bookId && conversionAbortControllerRef.current) {
      // Abort frontend signal immediately for responsive cancellation
      conversionAbortControllerRef.current.abort();
      
      // Call backend cancellation command if we have sourcePath
      const sourcePath = convertingSourcePathRef.current;
      if (sourcePath) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("cancel_conversion_command", { sourcePath });
        } catch (error) {
          logger.error("Failed to cancel conversion on backend:", error);
          // If backend call fails, still clear the cancelling state
          setIsCancelling(false);
          setCancellingBookId(null);
        }
      } else {
        // No source path, clear state immediately
        setIsCancelling(false);
        setCancellingBookId(null);
      }
      
      // Clear frontend conversion state immediately for instant UI feedback
      // But keep isCancelling true until we receive the event from backend
      conversionAbortControllerRef.current = null;
      convertingBookIdRef.current = null;
      convertingSourcePathRef.current = null;
      setIsConverting(false);
      conversionStartTimeRef.current = null;
      
      // If it was pending conversion, clear that too
      if (pendingBookForConversion?.book.id === bookId) {
        setPendingBookForConversion(null);
        setShowConvertDialog(false);
      }
      
      // Note: We don't clear isCancelling or show toast here
      // That will happen when we receive the conversion-cancelled event from backend
      // This ensures the UI shows "pausing" state immediately but final state only after backend confirms
    } else {
      // If no active conversion, just clear the cancelling state immediately
      setIsCancelling(false);
      setCancellingBookId(null);
    }
  }, [pendingBookForConversion]);

  return {
    showConvertDialog,
    setShowConvertDialog,
    pendingBookForConversion,
    setPendingBookForConversion,
    isConverting,
    conversionProgress,
    bookConversionProgress,
    isCancelling,
    cancellingBookId,
    convertingBookIdRef,
    conversionStartTimeRef,
    handleConvertToAudiobook,
    handleConvertBookFromDetail,
    cancelConversionForBook,
  };
}

