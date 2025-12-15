import type { UITheme } from "./ui";

export type VoiceId = string;

export type AppSettings = {
  theme: UITheme;
  ttsVoiceId: VoiceId;
  autoScrollEnabled?: boolean;
  audioPlaybackSpeed?: number;
};

