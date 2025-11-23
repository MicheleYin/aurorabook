import type { KokoroTTS } from "kokoro-js";

export type PlaybackState = "idle" | "loading" | "playing" | "paused";

export type VoiceId = keyof KokoroTTS["voices"];

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
};

export type NavItem = {
  href: string;
  label?: string;
  subitems?: NavItem[];
};

