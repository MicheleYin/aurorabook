import { invokeCommand } from './tauri.js';
import type { AppSettings } from '../types/settings.js';

/**
 * Get app settings
 */
export async function getAppSettings(): Promise<AppSettings> {
	const result = await invokeCommand<AppSettings>('get_app_settings', {});
	return result;
}

/**
 * Update app settings
 */
export async function updateAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
	const result = await invokeCommand<AppSettings>('update_app_settings', { settings });
	return result;
}

