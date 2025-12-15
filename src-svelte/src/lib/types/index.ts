// Types matching the Rust types from src-frontend

export type VoiceId = string;

export enum PlaybackState {
	Idle = 'Idle',
	Loading = 'Loading',
	Playing = 'Playing',
	Paused = 'Paused'
}

export interface AudioTrack {
	id: string;
	title: string;
	href: string;
	url?: string;
	duration?: number;
	order: number;
	loading?: boolean;
}

export interface AudioSyncSegment {
	textElementId: string;
	chapterHref: string;
	audioTrackHref: string;
	clipBegin: number;
	clipEnd: number;
}

export interface AudioSyncMap {
	segments: AudioSyncSegment[];
	lookup?: Map<string, number>;
}

export interface BookAudioState {
	currentTrackId: string;
	currentTrackHref: string;
	currentTrackIndex: number;
	currentTimeSeconds: number;
	updatedAt: string;
}

export interface Chapter {
	id: string;
	title: string;
	contentHtml?: string;
	plainText?: string;
	order: number;
	href: string;
	wordCount?: number;
	estimatedPageCount?: number;
	loading?: boolean;
}

export interface BookProgress {
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
	updatedAt: string;
}

export interface Book {
	id: string;
	title: string;
	author: string;
	chapters: Chapter[];
	coverUrl?: string;
	sourcePath: string;
	contentHash?: string;
	publisher?: string;
	publishedYear?: string;
	subjects?: string[];
	fileSizeBytes?: number;
	audioTracks: AudioTrack[];
	audioState?: BookAudioState;
	audioSyncMap?: AudioSyncMap;
	progress?: BookProgress;
	pageCount?: number;
	conversionStatus?: string; // "notStarted" | "started" | "done"
	completedChapters?: string[];
	voiceId?: VoiceId;
	totalWords?: number;
	wordsProcessed?: number;
	lastOpenedTime?: string;
}

export interface NavItem {
	href: string;
	label?: string;
	subitems?: NavItem[];
}

