export type ConversionStatus = "notStarted" | "started" | "done";

export interface BookProgress {
  currentChapterId?: string;
  currentChapterHref?: string;
  currentChapterIndex?: number;
  currentChapterElementId?: string;
  currentChapterElementIndex?: number;
  currentChapterScrollTop?: number;
  currentChapterScrollHeight?: number;
  currentChapterClientHeight?: number;
  chapterProgressPercent?: number;
  bookProgressPercent?: number;
  updatedAt?: string;
}

export interface BookAudioState {
  currentTrackId?: string;
  currentTrackHref?: string;
  currentTrackIndex?: number;
  currentTimeSeconds?: number;
  updatedAt?: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  href: string;
  chapterOrder: number;
  wordCount?: number;
  estimatedPageCount?: number;
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
}

export interface AudioTrack {
  id: string;
  bookId: string;
  chapterHref: string;
  filePath: string;
  href?: string; // Backend uses 'href', frontend may use 'filePath' - support both
  title?: string;
  duration?: number; // Duration in seconds
  fileSizeBytes?: number;
  order: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  chapters: Chapter[];
  coverUrl?: string;
  sourcePath: string;
  publisher?: string;
  publishedYear?: string;
  subjects?: string[];
  fileSizeBytes?: number;
  audioTracks: AudioTrack[];
  audioState?: BookAudioState;
  audioSyncMap?: AudioSyncMap;
  progress?: BookProgress;
  pageCount?: number;
  conversionStatus: ConversionStatus;
  completedChapters: string[];
  voiceId?: string;
  totalWords?: number;
  wordsProcessed?: number;
  lastOpenedTime?: string;
}

export interface ChapterWithContent extends Chapter {
  contentHtml?: string;
}

export interface AudioTrackWithData extends AudioTrack {
  data?: number[]; // Optional - not needed when using streaming
  mimeType: string;
  isLiveStream?: boolean;
  liveChapterIndex?: number;
}
