export interface AppSettings {
  theme: string; // "light" | "dark" | "system"
  ttsVoiceId: string;
  ttsLanguage?: string;
  autoScrollEnabled?: boolean;
  audioPlaybackSpeed?: number;
}
