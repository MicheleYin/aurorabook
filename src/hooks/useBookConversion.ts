import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { Book } from "../types/reader";
import type { VoiceId } from "../types/reader";
import type { ConversionProgress } from "../lib/audiobook-converter";
import { convertEpubToAudiobook } from "../lib/audiobook-converter";
import { getEpubBuffer } from "../lib/book-service";
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
  const conversionAbortControllerRef = useRef<AbortController | null>(null);
  const convertingBookIdRef = useRef<string | null>(null);
  const conversionStartTimeRef = useRef<number | null>(null);

  const handleConvertToAudiobook = useCallback(async (voiceId: VoiceId) => {
    if (!pendingBookForConversion || isConverting) return;
    
    // Create abort controller for this conversion
    const abortController = new AbortController();
    conversionAbortControllerRef.current = abortController;
    convertingBookIdRef.current = pendingBookForConversion.book.id;
    
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
      
      // Convert EPUB to audiobook - backend handles everything
      await convertEpubToAudiobook({
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
      
      // Remove the original book from library
      setLibrary((prev) => prev.filter((b) => b.id !== book.id));
      
      // Clear book cache to force fresh data from backend
      clearBookCache(book.sourcePath);
      
      
      
      // Refetch library from backend to ensure we have the latest data
      if (refreshLibrary) {
        await refreshLibrary();
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
      conversionStartTimeRef.current = null;
    }
  }, [pendingBookForConversion, isConverting, setLibrary, ingestEpub, refreshLibrary]);

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
      
      try {
        await convertEpubToAudiobook({
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
      
      console.debug("Conversion completed, reloading book from backend", {
        sourcePath: book.sourcePath,
      });
      
      // Clear book cache to force fresh data from backend
      clearBookCache(book.sourcePath);
      
      // Backend has stored the converted EPUB, reload it to update metadata
      const convertedBuffer = await getEpubBuffer(book.sourcePath);
      if (!convertedBuffer) {
        throw new Error("Converted EPUB not found in backend store");
      }
      
      
      // Refetch library from backend to ensure we have the latest data
      if (refreshLibrary) {
        await refreshLibrary();
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
      conversionStartTimeRef.current = null;
    }
  }, [isConverting, setLibrary, ingestEpub, refreshLibrary]);

  const cancelConversionForBook = useCallback((bookId: string) => {
    if (convertingBookIdRef.current === bookId && conversionAbortControllerRef.current) {
      conversionAbortControllerRef.current.abort();
      conversionAbortControllerRef.current = null;
      convertingBookIdRef.current = null;
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
      toast.info("Conversion cancelled", {
        description: "The conversion has been cancelled and the book has been removed.",
      });
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
    convertingBookIdRef,
    conversionStartTimeRef,
    handleConvertToAudiobook,
    handleConvertBookFromDetail,
    cancelConversionForBook,
  };
}

