export type PlaybackState = "idle" | "loading" | "playing" | "paused";

// VoiceId is a string identifier for Kokoro voices (e.g., "af_heart", "am_adam")
export type VoiceId = string;

export type AudioTrack = {
  id: string;
  title: string;
  href: string;
  url?: string; // Optional - loaded lazily
  duration?: number;
  _loading?: boolean; // Internal flag to track loading state
};

export type AudioSyncSegment = {
  textElementId: string;
  chapterHref: string;
  audioTrackHref: string;
  clipBegin: number; // seconds
  clipEnd: number; // seconds
};

export type AudioSyncMap = {
  segments: AudioSyncSegment[];
  // Map from audioTrackHref + time to segment index for quick lookup (optional, not used by findCurrentAudioSegment)
  lookup?: Map<string, number>;
};

export type BookAudioState = {
  currentTrackId: string;
  currentTrackHref: string;
  currentTrackIndex: number;
  currentTimeSeconds: number;
  updatedAt: string;
};

export type Chapter = {
  id: string;
  title: string;
  contentHtml?: string; // Optional - loaded lazily
  plainText?: string; // Optional - loaded lazily
  order: number;
  href: string;
  wordCount?: number;
  estimatedPageCount?: number;
  _loading?: boolean; // Internal flag to track loading state
};

export type BookProgress = {
  currentChapterId: string;
  currentChapterHref: string;
  currentChapterIndex: number;
  currentChapterElementId?: string | null;
  currentChapterElementIndex?: number | null;
  currentChapterScrollTop: number;
  currentChapterScrollHeight: number;
  currentChapterClientHeight: number;
  chapterProgressPercent: number;
  /** Overall book progress across all chapters (0.0 to 1.0) */
  bookProgressPercent: number;
  updatedAt: string;
};

export type Book = {
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
  conversionStarted?: boolean;
  completedChapters?: string[];
};

export type NavItem = {
  href: string;
  label?: string;
  subitems?: NavItem[];
};

export type ReaderTheme = "light" | "dark" | "system";

export type ReaderFont =
  | "merriweather"
  | "inter"
  | "lora"
  | "firaMono"
  | "atkinson";

export type ReaderContentPadding = "compact" | "comfortable" | "spacious";

export type ReaderFontSize = "small" | "medium" | "large" | "xlarge";

export type ReaderPreferences = {
  theme: ReaderTheme;
  fontFamily: ReaderFont;
  contentPadding: ReaderContentPadding;
  fontSize: ReaderFontSize;
};

