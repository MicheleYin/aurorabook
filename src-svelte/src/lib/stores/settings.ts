import { writable, derived } from 'svelte/store';
import { getAppSettings, updateAppSettings as updateSettingsService } from '../services/settingsService.js';
import { browser } from '$app/environment';
import type { AppSettings, UITheme } from '../types/settings.js';

const defaultSettings: AppSettings = {
	theme: UITheme.System,
	ttsVoiceId: 'af_heart',
	autoScrollEnabled: false,
	audioPlaybackSpeed: 1.0
};

export const settings = writable<AppSettings>(defaultSettings);
export const isSettingsHydrated = writable<boolean>(false);

// Resolved theme (system -> light/dark)
export const resolvedTheme = derived(settings, ($settings) => {
	if ($settings.theme === UITheme.System && browser) {
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		return prefersDark ? UITheme.Dark : UITheme.Light;
	}
	return $settings.theme;
});

export async function loadSettings() {
	try {
		const loadedSettings = await getAppSettings();
		settings.set(loadedSettings);
		isSettingsHydrated.set(true);
	} catch (error) {
		console.error('Failed to load settings:', error);
		isSettingsHydrated.set(true);
	}
}

export async function updateSettings(updates: Partial<AppSettings>) {
	try {
		const updated = await updateSettingsService(updates);
		settings.set(updated);
	} catch (error) {
		console.error('Failed to update settings:', error);
		throw error;
	}
}

