/** Shared playback engine contract for platform-specific audio backends. */

export type PlaybackEngineKind = "webview" | "ios-native" | "android";

export type EngineEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; time: number }
  | { type: "timeUpdate"; time: number }
  | { type: "durationUpdate"; time: number }
  | { type: "ended" }
  | { type: "next" }
  | { type: "prev" };

export type LoadTrackOptions = {
  bookId: string;
  trackId: string;
  title: string;
  artist: string;
  duration: number;
  coverUrl?: string | null;
  /** HTTP stream URL for webview engines (unused on iOS native). */
  streamUrl?: string;
  playbackRate?: number;
};

export type LoadLiveOptions = {
  bookId: string;
  chapterIndex: number;
  title: string;
  artist: string;
  coverUrl?: string | null;
};

export type LiveStatus = {
  durationSeconds: number;
  byteLength: number;
};

export interface PlaybackEngine {
  readonly kind: PlaybackEngineKind;
  load(options: LoadTrackOptions): Promise<void>;
  loadLive?(options: LoadLiveOptions): Promise<LiveStatus>;
  refreshLive?(
    bookId: string,
    chapterIndex: number
  ): Promise<LiveStatus>;
  setExpectsMore?(expectsMore: boolean): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setRate(rate: number): Promise<void>;
  getCurrentTime(): number;
  isPlaying(): boolean;
  subscribe(listener: (event: EngineEvent) => void): () => void;
  destroy(): void;
}
