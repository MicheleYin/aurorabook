import { invoke } from '@tauri-apps/api/core';
import type { Book, Chapter } from '../types/index.js';

export interface LibraryFilter {
	filter?: string; // "all" | "new" | "resume" | "finished" | "recent" | "author"
	search?: string;
}

/**
 * Invoke a Tauri command
 */
export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	try {
		const result = await invoke<T>(command, args);
		return result;
	} catch (error) {
		throw new Error(`Command ${command} failed: ${error}`);
	}
}

/**
 * Listen to a Tauri event
 */
export async function listenEvent<T>(
	eventName: string,
	callback: (payload: T) => void
): Promise<() => void> {
	const { listen } = await import('@tauri-apps/api/event');
	const unlisten = await listen<T>(eventName, (event) => {
		callback(event.payload);
	});
	return unlisten;
}

