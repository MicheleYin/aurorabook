import { invokeCommand } from './tauri.js';
import type { Book, VoiceId } from '../types/index.js';

/**
 * Convert EPUB to audiobook
 */
export async function convertEpubToAudiobook(
	bookId: string,
	voiceId: VoiceId
): Promise<Book | null> {
	return await invokeCommand<Book | null>('convert_epub_to_audiobook_command', { bookId, voiceId });
}

/**
 * Cancel conversion
 */
export async function cancelConversion(sourcePath: string): Promise<void> {
	await invokeCommand<void>('cancel_conversion_command', { sourcePath });
}

