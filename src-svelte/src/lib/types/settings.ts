import type { VoiceId } from './index.js';

export enum UITheme {
	Light = 'light',
	Dark = 'dark',
	System = 'system'
}

export interface AppSettings {
	theme: UITheme;
	ttsVoiceId: VoiceId;
	autoScrollEnabled?: boolean;
	audioPlaybackSpeed?: number;
}

