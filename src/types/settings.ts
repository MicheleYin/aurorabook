export interface AppSettings {
  theme: string; // "light" | "dark" | "system"
  ttsVoiceId: string;
  autoScrollEnabled?: boolean;
  audioPlaybackSpeed?: number;
}
