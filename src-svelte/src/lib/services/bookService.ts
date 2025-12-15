import { invokeCommand, type LibraryFilter } from './tauri.js';
import type { Book, Chapter } from '../types/index.js';

/**
 * Strip content from chapters and audio tracks to keep only metadata
 */
function stripBookContent(book: Book): Book {
	return {
		...book,
		chapters: book.chapters.map((chapter) => ({
			...chapter,
			contentHtml: undefined,
			plainText: undefined
		})),
		audioTracks: book.audioTracks.map((track) => ({
			...track,
			url: undefined
		})),
		audioSyncMap: undefined
	};
}

/**
 * Read all books with optional filtering and search
 */
export async function readAllBooks(filter?: LibraryFilter): Promise<Book[]> {
	const books = await invokeCommand<Book[]>('read_all_books', { filter });
	return books.map(stripBookContent);
}

/**
 * Read a single complete book by ID
 */
export async function readOneBook(bookId: string): Promise<Book | null> {
	const book = await invokeCommand<Book | null>('read_one_book', { bookId });
	return book;
}

/**
 * Read a single chapter by book ID and chapter ID
 */
export async function readSingleChapter(bookId: string, chapterId: string): Promise<Chapter | null> {
	return await invokeCommand<Chapter | null>('read_single_chapter', { bookId, chapterId });
}

/**
 * Load chapter content (HTML) by book ID and chapter ID
 */
export async function loadChapterContent(bookId: string, chapterId: string): Promise<Chapter | null> {
	return await invokeCommand<Chapter | null>('load_chapter_content', { bookId, chapterId });
}

/**
 * Delete a book
 */
export async function deleteBook(bookId: string): Promise<void> {
	await invokeCommand<void>('delete_book', { bookId });
}

/**
 * Update book progress
 */
export async function updateBookProgress(
	bookId: string,
	progress: {
		currentChapterId: string;
		currentChapterHref: string;
		currentChapterIndex: number;
		currentChapterElementId?: string;
		currentChapterElementIndex?: number;
		currentChapterScrollTop: number;
		currentChapterScrollHeight: number;
		currentChapterClientHeight: number;
		chapterProgressPercent: number;
		bookProgressPercent: number;
	}
): Promise<void> {
	await invokeCommand<void>('update_book_progress', { bookId, progress });
}

/**
 * Update book audio state
 */
export async function updateBookAudioState(
	bookId: string,
	audioState: {
		currentTrackId: string;
		currentTrackHref: string;
		currentTrackIndex: number;
		currentTimeSeconds: number;
	}
): Promise<void> {
	await invokeCommand<void>('update_book_audio_state', { bookId, audioState });
}

/**
 * Load EPUB image
 */
export async function loadEpubImage(bookId: string, href: string): Promise<string | null> {
	return await invokeCommand<string | null>('load_epub_image', { bookId, href });
}

/**
 * Load EPUB audio
 */
export async function loadEpubAudio(bookId: string, href: string): Promise<string | null> {
	return await invokeCommand<string | null>('load_epub_audio', { bookId, href });
}

/**
 * Ingest an EPUB file
 */
export async function ingestEpub(sourcePath: string, targetPath: string): Promise<Book> {
	return await invokeCommand<Book>('ingest_epub', { sourcePath, targetPath });
}

/**
 * Export EPUB to file
 */
export async function exportEpubToFile(bookId: string, targetPath: string): Promise<void> {
	await invokeCommand<void>('export_epub_to_file', { bookId, targetPath });
}

