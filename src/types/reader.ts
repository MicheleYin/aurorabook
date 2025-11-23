import type { KokoroTTS } from "kokoro-js";

export type PlaybackState = "idle" | "loading" | "playing" | "paused";

export type VoiceId = keyof KokoroTTS["voices"];

export type AudioTrack = {
  id: string;
  title: string;
  href: string;
  url: string;
  duration?: number;
};

export type Chapter = {
  id: string;
  title: string;
  contentHtml: string;
  plainText: string;
  order: number;
  href: string;
};

export type Book = {
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
};

export type NavItem = {
  href: string;
  label?: string;
  subitems?: NavItem[];
};

export type ReaderTheme = "light" | "dark" | "sepia" | "system";

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

