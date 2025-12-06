import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import type { Book } from "../types/reader";
import type { VoiceId } from "../types/reader";
import type { ConversionProgress } from "../lib/audiobook-converter";
import { convertEpubToAudiobook } from "../lib/audiobook-converter";
import { getEpubBuffer, readAllBooks, readOneBook } from "../lib/book-service";
import { clearBookCache } from "../lib/lazy-chapter-loader";

export type PendingBookForConversion = {
  book: Book;
  buffer: ArrayBuffer;
};

export function useBookConversion(
  setLibrary: React.Dispatch<React.SetStateAction<Book[]>>,
  ingestEpub: (params: {
    filePath: string;
    sourcePath: string;
    fallbackTitle?: string;
    progress?: Book["progress"];
    pageCountHint?: number;
  }) => Promise<Book | null>,
  refreshLibrary?: () => Promise<void>,
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

  // Listen for chapter completion events to refresh the book
  useEffect(() => {
    // Only set up listener once
    if (listenerSetupRef.current) {
      return;
    }
    
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      try {
        unlisten = await listen<{
          source_path: string;
          chapter_index: number;
          total_chapters: number;
          chapter_title: string;
          audio_generated: boolean;
        }>("chapter-completed", async (event) => {
          const { source_path, chapter_title, audio_generated } = event.payload;
          
          // Fetch the updated book and merge only audio-related fields
          // This preserves the existing book state so audio playback doesn't stop
          try {
            // First, get all books to find the one with matching sourcePath
            const allBooks = await readAllBooks();
            const existingBook = allBooks.find(
              (book) => book.sourcePath === source_path
            );
            
            if (!existingBook) {
              console.warn("Book not found in library for source_path:", source_path);
              return;
            }
            
            // Fetch the updated book from backend
            const updatedBook = await readOneBook(existingBook.id);
            
            if (!updatedBook) {
              console.warn("Failed to fetch updated book:", existingBook.id);
              return;
            }
            
            // Merge only audio-related fields into the existing book
            // This preserves all other state including loaded chapters, audio playback state, etc.
            setLibrary((currentLibrary) => {
              const bookIndex = currentLibrary.findIndex(
                (book) => book.id === existingBook.id || book.sourcePath === source_path
              );
              
              if (bookIndex === -1) {
                // Book not in current library state, add it
                return [...currentLibrary, updatedBook];
              }
              
              const currentBook = currentLibrary[bookIndex];
              
              // Create merged book with only audio fields updated
              const mergedBook: Book = {
                ...currentBook,
                fileSizeBytes: updatedBook.fileSizeBytes,
                // Only update audio-related fields
                audioTracks: updatedBook.audioTracks,
                audioSyncMap: updatedBook.audioSyncMap,
                // Also update conversion status and completed chapters
                conversionStatus: updatedBook.conversionStatus,
                completedChapters: updatedBook.completedChapters,
              };

              
              const updated = [...currentLibrary];
              updated[bookIndex] = mergedBook;
              
              return updated;
            });
            
            // Show notification that a new chapter is available only if audio was generated
            if (audio_generated) {
              toast.info("New chapter available", {
                description: `"${chapter_title}" has been converted and is ready to play.`,
                duration: 5000,
              });
            }
          } catch (error) {
            console.warn("Failed to refresh book after chapter completion:", error);
          }
        });
        
        listenerSetupRef.current = true;
      } catch (error) {
        console.warn("Failed to set up chapter-completed event listener:", error);
      }
    };

    void setupListener();

    return () => {
      if (unlisten) {
        unlisten();
        listenerSetupRef.current = false;
      }
    };
  }, []); // Empty dependency array - only set up once

  const handleConvertToAudiobook = useCallback(async (voiceId: VoiceId) => {
    if (!pendingBookForConversion || isConverting || isCancelling) return;
    
    // Create abort controller for this conversion
    const abortController = new AbortController();
    conversionAbortControllerRef.current = abortController;
    convertingBookIdRef.current = pendingBookForConversion.book.id;
    convertingSourcePathRef.current = pendingBookForConversion.book.sourcePath;
    
    setIsConverting(true);
    setShowConvertDialog(false);
    setConversionProgress({
      currentChapter: 0,
      totalChapters: 1,
      wordsProcessed: 0,
      totalWords: 0,
      wordsInCurrentChapter: 0,
      currentStep: "initializing",
      message: "Starting conversion...",
    });
    
    conversionStartTimeRef.current = Date.now();
    const bookId = pendingBookForConversion.book.id;
    
    try {
      const { book } = pendingBookForConversion;
      
      // Load EPUB buffer before conversion
      const epubBuffer = await getEpubBuffer(book.sourcePath);
      if (!epubBuffer) {
        throw new Error("Failed to load EPUB file for conversion");
      }
      
      // Convert EPUB to audiobook - backend handles everything and returns updated Book
      const updatedBook = await convertEpubToAudiobook({
        sourcePath: book.sourcePath,
        epubData: epubBuffer,
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
      convertingSourcePathRef.current = null;
      conversionStartTimeRef.current = null;
    }
  }, [pendingBookForConversion, isConverting, isCancelling, setLibrary, ingestEpub, refreshLibrary]);

  const handleConvertBookFromDetail = useCallback(async (book: Book, voiceId: VoiceId) => {
    // Allow conversion if book has started status (for resuming) even if some tracks exist
    const conversionStatus = book.conversionStatus ?? "notStarted";
    if (book.audioTracks.length > 0 && conversionStatus === "notStarted") {
      console.log("Skipping conversion - book already has audio tracks and conversion not started");
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
    
    // Create abort controller for this conversion
    const abortController = new AbortController();
    conversionAbortControllerRef.current = abortController;
    convertingBookIdRef.current = book.id;
    convertingSourcePathRef.current = book.sourcePath;
    
    setIsConverting(true);
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
    
    try {
      if (book.sourcePath.startsWith("web://")) {
        // Web file - we can't reload it, show error
        toast.error("Cannot convert web files", {
          description: "Please re-import the file to convert it.",
        });
        setIsConverting(false);
        conversionAbortControllerRef.current = null;
        convertingBookIdRef.current = null;
        convertingSourcePathRef.current = null;
        return;
      }
      
      // Load EPUB buffer before conversion
      const epubBuffer = await getEpubBuffer(book.sourcePath);
      if (!epubBuffer) {
        throw new Error("Failed to load EPUB file for conversion");
      }
      
      // Convert EPUB to audiobook - backend handles everything (extracts chapters, generates audio, stores result)
      console.debug("Starting EPUB conversion", {
        sourcePath: book.sourcePath,
        voiceId,
        epubSize: epubBuffer.byteLength,
      });
      
      let updatedBook: Book | null = null;
      try {
        updatedBook = await convertEpubToAudiobook({
          sourcePath: book.sourcePath,
          epubData: epubBuffer,
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
      
      console.debug("Conversion completed, updating library with returned book data", {
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
      convertingSourcePathRef.current = null;
      conversionStartTimeRef.current = null;
    }
  }, [isConverting, isCancelling, setLibrary, ingestEpub, refreshLibrary]);

  const cancelConversionForBook = useCallback(async (bookId: string) => {
    // Immediately update UI to show cancellation in progress
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
          console.error("Failed to cancel conversion on backend:", error);
        }
      }
      
      // Clear state immediately for instant UI feedback
      conversionAbortControllerRef.current = null;
      convertingBookIdRef.current = null;
      convertingSourcePathRef.current = null;
      setIsConverting(false);
      setConversionProgress(null);
      conversionStartTimeRef.current = null;
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
      
      // Keep the loading state visible briefly to show cancellation is processing
      // This gives visual feedback that the action was registered
      await new Promise(resolve => setTimeout(resolve, 300));
      
      setIsCancelling(false);
      setCancellingBookId(null);
      
      toast.info("Conversion cancelled", {
        description: "The conversion has been cancelled.",
      });
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

