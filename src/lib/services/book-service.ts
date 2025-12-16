/**
 * Book service - frontend interface to Rust backend book management
 * All book operations are handled by the Rust backend via Tauri commands
 */

import { invoke } from "@tauri-apps/api/core";
import type { Book } from "../types/reader";

export interface LibraryFilter {
  filter?: "all" | "new" | "resume" | "finished" | "recent" | "author";
  search?: string;
}

/**
 * Read all books with optional filtering and search
 * Does NOT preload chapter content - chapters are loaded lazily when needed
 */
export async function readAllBooks(filter?: LibraryFilter): Promise<Book[]> {
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
 * Ingest EPUB file from a given file path.
 * The backend will read the file and parse its metadata.
 */
export async function ingestEpub(filePath: string, sourcePath: string): Promise<Book> {
  try {
    const book = await invoke<Book>("ingest_epub", {
      epubPath: filePath,
      sourcePath,
    });
    return book;
  } catch (error) {
    console.error("Failed to ingest EPUB:", error);
    throw error;
  }
}

/**
 * Add a new book to the library
 */
export async function addBook(book: Book, epubData?: ArrayBuffer): Promise<Book> {
  try {
    const epubBytes = epubData ? Array.from(new Uint8Array(epubData)) : undefined;
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





