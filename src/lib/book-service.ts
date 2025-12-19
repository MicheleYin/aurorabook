/**
 * Book service - frontend interface to Rust backend book management
 * All book operations are handled by the Rust backend via Tauri commands
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";
import type { Book, Chapter, AudioTrack } from "../types/reader";

export interface LibraryFilter {
  filter?: "all" | "new" | "resume" | "finished" | "recent" | "author";
  search?: string;
}

/**
 * Read all books with optional filtering and search
 * Does NOT preload chapter content - chapters are loaded lazily when needed
 */
export async function readAllBooks(
  filter?: LibraryFilter
): Promise<Book[]> {
  try {
    const books = await invoke<Book[]>("read_all_books", { filter });
    // Return books without preloading - chapters will be loaded on-demand
    return books;
  } catch (error) {
    logger.error("Failed to read all books:", error);
    throw error;
  }
}

/**
 * Read a single complete book by ID
 * Does NOT preload all chapters - only loads the active chapter and adjacent ones
 * This prevents slow loading for large books
 */
export async function readOneBook(bookId: string): Promise<Book | null> {
  try {
    const book = await invoke<Book | null>("read_one_book", { bookId });
    if (!book) {
      return null;
    }
    
    // Don't preload all chapters - they'll be loaded lazily when needed
    // This significantly improves performance for large books
    return book;
  } catch (error) {
    logger.error("Failed to read book:", error);
    throw error;
  }
}

/**
 * Read a single chapter by book ID and chapter ID
 * Returns chapter metadata only (no content)
 */
export async function readSingleChapter(
  bookId: string,
  chapterId: string
): Promise<Chapter | null> {
  try {
    const chapter = await invoke<Chapter | null>("read_single_chapter", {
      bookId,
      chapterId,
    });
    return chapter;
  } catch (error) {
    logger.error("Failed to read chapter:", error);
    throw error;
  }
}

/**
 * Load chapter content from EPUB file
 * This loads the actual chapter HTML content from the EPUB file stored in the backend
 */
export async function loadChapterContent(
  bookId: string,
  chapterHref: string
): Promise<Chapter | null> {
  try {
    const chapter = await invoke<Chapter | null>("load_chapter_content", {
      bookId,
      chapterHref,
    });
    return chapter;
  } catch (error) {
    logger.error("Failed to load chapter content:", error);
    throw error;
  }
}

/**
 * Load a chapter from EPUB file and return as a Blob URL
 * This is more efficient for large files as it avoids base64 encoding overhead
 * 
 * CENTRALIZED: Automatically registers blob URL with blobURLManager.
 * Callers should NOT register it again - this function handles it.
 * 
 * Returns a tuple of (blobUrl, htmlString) where:
 * - blobUrl is a Blob URL that is already registered and managed centrally
 * - htmlString is the HTML content as a string (for direct DOM insertion)
 */
export async function loadEpubChapterBlob(
  bookId: string,
  chapterHref: string
): Promise<{ blobUrl: string; htmlString: string } | null> {
  logger.debug("[BookService] loadEpubChapterBlob called", {
    bookId,
    chapterHref,
  });
  try {
    const result = await invoke<[number[], string] | null>("load_epub_chapter_bytes", {
      bookId,
      chapterHref,
    });
    
    if (!result) {
      logger.debug("[BookService] loadEpubChapterBlob result: not found", {
        bookId,
        chapterHref,
      });
      return null;
    }
    
    const [bytes, mimeType] = result;
    
    // Convert number array to Uint8Array
    const uint8Array = new Uint8Array(bytes);
    
    // Decode bytes to get HTML string (for direct DOM insertion)
    const htmlString = new TextDecoder("utf-8").decode(uint8Array);
    
    // Create Blob URL
    const blob = new Blob([uint8Array], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    
    // CENTRALIZED: Register blob URL immediately when created
    // This ensures all blob URLs are tracked in one place
    if (blobUrl.startsWith("blob:")) {
      const { blobURLManager } = await import("./blob-url-manager");
      blobURLManager.register(bookId, blobUrl, "other", false);
    }
    
    logger.debug("[BookService] loadEpubChapterBlob result: success", {
      bookId,
      chapterHref,
      bytesLength: bytes.length,
      htmlLength: htmlString.length,
      mimeType,
      isBlobUrl: blobUrl.startsWith("blob:"),
    });
    
    return { blobUrl, htmlString };
  } catch (error) {
    logger.error("[BookService] Failed to load EPUB chapter bytes:", {
      bookId,
      chapterHref,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Load an image from EPUB file and return as base64 data URL
 * This resolves relative image paths relative to the chapter location
 */
export async function loadEpubImage(
  bookId: string,
  imageHref: string,
  chapterHref?: string
): Promise<string | null> {
  logger.debug("[BookService] loadEpubImage called", {
    bookId,
    imageHref,
    chapterHref,
  });
  try {
    const dataUrl = await invoke<string | null>("load_epub_image", {
      bookId,
      imageHref,
      chapterHref,
    });
    logger.debug("[BookService] loadEpubImage result", {
      bookId,
      imageHref,
      chapterHref,
      found: !!dataUrl,
      dataUrlLength: dataUrl?.length || 0,
    });
    return dataUrl;
  } catch (error) {
    logger.error("[BookService] Failed to load EPUB image:", {
      bookId,
      imageHref,
      chapterHref,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Load an audio track from EPUB file and return as base64 data URL
 * This resolves relative audio paths relative to the OPF location
 * @deprecated Use loadEpubAudioBlob instead for better performance with large files
 */
export async function loadEpubAudio(
  bookId: string,
  audioHref: string
): Promise<string | null> {
  logger.debug("[BookService] loadEpubAudio called", {
    bookId,
    audioHref,
  });
  try {
    const dataUrl = await invoke<string | null>("load_epub_audio", {
      bookId,
      audioHref,
    });
    logger.debug("[BookService] loadEpubAudio result", {
      bookId,
      audioHref,
      found: !!dataUrl,
      dataUrlLength: dataUrl?.length || 0,
    });
    return dataUrl;
  } catch (error) {
    logger.error("[BookService] Failed to load EPUB audio:", {
      bookId,
      audioHref,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Load an audio track from EPUB file and return as a Blob URL
 * This is more efficient for large files as it avoids base64 encoding overhead
 * 
 * CENTRALIZED: Automatically registers blob URL with blobURLManager.
 * Callers should NOT register it again - this function handles it.
 * 
 * Returns a Blob URL that is already registered and managed centrally.
 */
export async function loadEpubAudioBlob(
  bookId: string,
  audioHref: string
): Promise<string | null> {
  logger.debug("[BookService] loadEpubAudioBlob called", {
    bookId,
    audioHref,
  });
  try {
    const result = await invoke<[number[], string] | null>("load_epub_audio_bytes", {
      bookId,
      audioHref,
    });
    
    if (!result) {
      logger.debug("[BookService] loadEpubAudioBlob result: not found", {
        bookId,
        audioHref,
      });
      return null;
    }
    
    const [bytes, mimeType] = result;
    
    // Convert number array to Uint8Array
    const uint8Array = new Uint8Array(bytes);
    
    // Create Blob URL
    const blob = new Blob([uint8Array], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    
    // CENTRALIZED: Register blob URL immediately when created
    // This ensures all blob URLs are tracked in one place
    // Auto-revokes previous audio track for this book
    if (blobUrl.startsWith("blob:")) {
      const { blobURLManager } = await import("./blob-url-manager");
      blobURLManager.register(bookId, blobUrl, "audio", true);
    }
    
    logger.debug("[BookService] loadEpubAudioBlob result: success", {
      bookId,
      audioHref,
      bytesLength: bytes.length,
      mimeType,
      isBlobUrl: blobUrl.startsWith("blob:"),
    });
    
    return blobUrl;
  } catch (error) {
    logger.error("[BookService] Failed to load EPUB audio bytes:", {
      bookId,
      audioHref,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Read a single audio track by book ID and track ID
 */
export async function readSingleAudioTrack(
  bookId: string,
  trackId: string
): Promise<AudioTrack | null> {
  try {
    const track = await invoke<AudioTrack | null>("read_single_audio_track", {
      bookId,
      trackId,
    });
    return track;
  } catch (error) {
    logger.error("Failed to read audio track:", error);
    throw error;
  }
}

/**
 * Delete a book by ID
 */
export async function deleteBook(bookId: string): Promise<void> {
  try {
    await invoke("delete_book", { bookId });
  } catch (error) {
    logger.error("Failed to delete book:", error);
    throw error;
  }
}


/**
 * Add a new book to the library
 */
export async function addBook(
  book: Book,
  epubData?: ArrayBuffer
): Promise<Book> {
  try {
    const epubBytes = epubData
      ? Array.from(new Uint8Array(epubData))
      : undefined;
    const result = await invoke<Book>("add_book", {
      book,
      epubData: epubBytes,
    });
    return result;
  } catch (error) {
    logger.error("Failed to add book:", error);
    throw error;
  }
}

/**
 * Get EPUB buffer for a book
 */
export async function getEpubBuffer(
  sourcePath: string
): Promise<ArrayBuffer | null> {
  try {
    const bytes = await invoke<number[] | null>("get_epub_buffer", {
      sourcePath,
    });
    if (!bytes) {
      return null;
    }
    return new Uint8Array(bytes).buffer;
  } catch (error) {
    logger.error("Failed to get EPUB buffer:", error);
    throw error;
  }
}

/**
 * Export EPUB file directly to disk (optimized for large files)
 * This avoids the overhead of serializing large binary data through Tauri IPC
 */
export async function exportEpubToFile(
  bookId: string,
  outputPath: string
): Promise<void> {
  try {
    await invoke<void>("export_epub_to_file", {
      bookId,
      outputPath,
    });
  } catch (error) {
    logger.error("Failed to export EPUB:", error);
    throw error;
  }
}

/**
 * Update book progress
 */
export async function updateBookProgress(
  bookId: string,
  progress: Book["progress"]
): Promise<Book> {
  if (!progress) {
    throw new Error("Progress is required");
  }
  try {
    const book = await invoke<Book>("update_book_progress", {
      bookId,
      progress,
    });
    return book;
  } catch (error) {
    logger.error("Failed to update book progress:", error);
    throw error;
  }
}

/**
 * Update book audio state
 */
export async function updateBookAudioState(
  bookId: string,
  audioState: Book["audioState"]
): Promise<Book> {
  if (!audioState) {
    throw new Error("Audio state is required");
  }
  try {
    const book = await invoke<Book>("update_book_audio_state", {
      bookId,
      audioState,
    });
    return book;
  } catch (error) {
    logger.error("Failed to update book audio state:", error);
    throw error;
  }
}

/**
 * Ingest EPUB file from a given file path.
 * The backend will read the file and parse its metadata.
 */
export async function ingestEpub(
  filePath: string,
  sourcePath: string
): Promise<Book> {
  try {
    const book = await invoke<Book>("ingest_epub", {
      epubPath: filePath, // Pass file path to backend
      sourcePath,
    });
    return book;
  } catch (error) {
    logger.error("Failed to ingest EPUB:", error);
    throw error;
  }
}

