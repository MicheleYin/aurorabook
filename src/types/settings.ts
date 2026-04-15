export interface AppSettings {
  theme: string; // "light" | "dark" | "system"
  language: string; // "en" | "es" | "it" | "zh"
  ttsVoiceId: string;
  ttsLanguage: string; // "en" | "es" | "it" | "zh"
  autoScrollEnabled?: boolean;
  audioPlaybackSpeed?: number;
}
