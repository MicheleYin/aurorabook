import { open, save } from '@tauri-apps/plugin-dialog';

/**
 * Open file dialog
 */
export async function openFileDialog(): Promise<string | null> {
	const selected = await open({
		multiple: false,
		filters: [
			{
				name: 'EPUB',
				extensions: ['epub']
			}
		]
	});

	if (Array.isArray(selected)) {
		return selected[0] || null;
	}
	return selected || null;
}

/**
 * Save file dialog
 */
export async function saveFileDialog(defaultPath?: string): Promise<string | null> {
	const selected = await save({
		defaultPath,
		filters: [
			{
				name: 'EPUB',
				extensions: ['epub']
			}
		]
	});
	return selected || null;
}

