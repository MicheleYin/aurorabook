import { writable } from 'svelte/store';
import type { Book } from '../types/index.js';

export const activeBookId = writable<string | null>(null);
export const activeBook = writable<Book | null>(null);

export function setActiveBook(book: Book | null) {
	if (book) {
		activeBookId.set(book.id);
		activeBook.set(book);
	} else {
		activeBookId.set(null);
		activeBook.set(null);
	}
}

export function clearActiveBook() {
	activeBookId.set(null);
	activeBook.set(null);
}

