/**
 * Book service - frontend interface to Rust backend book management
 * All book operations are handled by the Rust backend via Tauri commands
 */

import { invoke } from "@tauri-apps/api/core";
import type { Book, Chapter, AudioTrack } from "../types/reader";

export interface LibraryFilter {
  filter?: "all" | "new" | "resume" | "finished" | "recent" | "author";
  search?: string;
}

/**
 * Read all books with optional filtering and search
 */
export async function readAllBooks(
  filter?: LibraryFilter
): Promise<Book[]> {
  try {
    const books = await invoke<Book[]>("read_all_books", { filter });
    return books;
  } catch (error) {
    console.error("Failed to read all books:", error);
    throw error;
  }
}

/**
 * Read a single complete book by ID
 */
export async function readOneBook(bookId: string): Promise<Book | null> {
  try {
    const book = await invoke<Book | null>("read_one_book", { bookId });
    return book;
  } catch (error) {
    console.error("Failed to read book:", error);
    throw error;
  }
}

/**
 * Read a single chapter by book ID and chapter ID
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
    console.error("Failed to read chapter:", error);
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
    console.error("Failed to read audio track:", error);
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
    console.error("Failed to delete book:", error);
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
    console.error("Failed to add book:", error);
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
    console.error("Failed to get EPUB buffer:", error);
    throw error;
  }
}

