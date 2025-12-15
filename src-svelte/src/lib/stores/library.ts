import { writable, derived, get } from 'svelte/store';
import { readAllBooks, readOneBook, deleteBook as deleteBookService } from '../services/bookService.js';
import type { Book } from '../types/index.js';

export const library = writable<Book[]>([]);
export const isLoadingLibrary = writable<boolean>(false);

export async function refreshLibrary() {
	isLoadingLibrary.set(true);
	try {
		const books = await readAllBooks();
		library.set(books);
	} catch (error) {
		console.error('Failed to refresh library:', error);
	} finally {
		isLoadingLibrary.set(false);
	}
}

export async function deleteBook(bookId: string) {
	try {
		await deleteBookService(bookId);
		library.update((books) => books.filter((b) => b.id !== bookId));
	} catch (error) {
		console.error('Failed to delete book:', error);
		throw error;
	}
}

export async function updateBookInLibrary(bookId: string) {
	try {
		const updatedBook = await readOneBook(bookId);
		if (updatedBook) {
			library.update((books) => {
				const index = books.findIndex((b) => b.id === bookId);
				if (index >= 0) {
					books[index] = updatedBook;
				}
				return books;
			});
		}
	} catch (error) {
		console.error('Failed to update book in library:', error);
	}
}

