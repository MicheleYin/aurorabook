import { writable } from 'svelte/store';
import type { ConversionProgress } from '../types/conversion.js';

export const conversionProgress = writable<Map<string, ConversionProgress>>(new Map());
export const convertingBookId = writable<string | null>(null);
export const cancellingBookId = writable<string | null>(null);
export const conversionStartTimes = writable<Map<string, number>>(new Map());
export const convertingSourcePaths = writable<Map<string, string>>(new Map());

export function setProgress(bookId: string, progress: ConversionProgress) {
	conversionProgress.update((map) => {
		map.set(bookId, progress);
		return map;
	});
}

export function clearProgress(bookId: string) {
	conversionProgress.update((map) => {
		map.delete(bookId);
		return map;
	});
}

export function getProgress(bookId: string): ConversionProgress | undefined {
	// This is a helper that requires reactive context
	// Use the store directly in components: $conversionProgress.get(bookId)
	return undefined;
}

