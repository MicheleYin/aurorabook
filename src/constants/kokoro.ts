import type { VoiceId } from "../types/reader";

export const DEFAULT_KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_KOKORO_VOICE_ID: VoiceId = "af_heart";
export const KOKORO_MODEL_CARD_URL = `https://huggingface.co/${DEFAULT_KOKORO_MODEL_ID}`;
export const KOKORO_VOICE_DATASET_URL = "https://huggingface.co/datasets/hexgrad/Kokoro-voices";

export type KokoroVoiceOption = {
  id: VoiceId;
  name: string;
  gender: "Female" | "Male";
  languageTag: string;
  summary: string;
};

export type KokoroVoiceGroup = {
  label: string;
  voices: KokoroVoiceOption[];
};

const americanVoices: KokoroVoiceOption[] = [
  {
    id: "af_heart",
    name: "Heart",
    gender: "Female",
    languageTag: "en-US",
    summary: "Expressive default, Grade A",
  },
  {
    id: "af_alloy",
    name: "Alloy",
    gender: "Female",
    languageTag: "en-US",
    summary: "Bright & steady, Grade C",
  },
  {
    id: "af_aoede",
    name: "Aoede",
    gender: "Female",
    languageTag: "en-US",
    summary: "Balanced tone, Grade C+",
  },
  {
    id: "af_bella",
    name: "Bella",
    gender: "Female",
    languageTag: "en-US",
    summary: "Warm storyteller, Grade A-",
  },
  {
    id: "af_jessica",
    name: "Jessica",
    gender: "Female",
    languageTag: "en-US",
    summary: "Soft conversational, Grade D",
  },
  {
    id: "af_kore",
    name: "Kore",
    gender: "Female",
    languageTag: "en-US",
    summary: "Neutral & calm, Grade C+",
  },
  {
    id: "af_nicole",
    name: "Nicole",
    gender: "Female",
    languageTag: "en-US",
    summary: "Headphone-ready, Grade B-",
  },
  {
    id: "af_nova",
    name: "Nova",
    gender: "Female",
    languageTag: "en-US",
    summary: "Friendly narrator, Grade C",
  },
  {
    id: "af_river",
    name: "River",
    gender: "Female",
    languageTag: "en-US",
    summary: "Airy light tone, Grade D",
  },
  {
    id: "af_sarah",
    name: "Sarah",
    gender: "Female",
    languageTag: "en-US",
    summary: "Clear generalist, Grade C+",
  },
  {
    id: "af_sky",
    name: "Sky",
    gender: "Female",
    languageTag: "en-US",
    summary: "Crisp & bright, Grade C-",
  },
  {
    id: "am_adam",
    name: "Adam",
    gender: "Male",
    languageTag: "en-US",
    summary: "Casual tenor, Grade F+",
  },
  {
    id: "am_echo",
    name: "Echo",
    gender: "Male",
    languageTag: "en-US",
    summary: "Even delivery, Grade D",
  },
  {
    id: "am_eric",
    name: "Eric",
    gender: "Male",
    languageTag: "en-US",
    summary: "Relaxed & warm, Grade D",
  },
  {
    id: "am_fenrir",
    name: "Fenrir",
    gender: "Male",
    languageTag: "en-US",
    summary: "Deep & bold, Grade C+",
  },
  {
    id: "am_liam",
    name: "Liam",
    gender: "Male",
    languageTag: "en-US",
    summary: "Bright tenor, Grade D",
  },
  {
    id: "am_michael",
    name: "Michael",
    gender: "Male",
    languageTag: "en-US",
    summary: "Presenter feel, Grade C+",
  },
  {
    id: "am_onyx",
    name: "Onyx",
    gender: "Male",
    languageTag: "en-US",
    summary: "Neutral & modern, Grade D",
  },
  {
    id: "am_puck",
    name: "Puck",
    gender: "Male",
    languageTag: "en-US",
    summary: "Playful narrator, Grade C+",
  },
  {
    id: "am_santa",
    name: "Santa",
    gender: "Male",
    languageTag: "en-US",
    summary: "Cheerful bass, Grade D-",
  },
];

const britishVoices: KokoroVoiceOption[] = [
  {
    id: "bf_alice",
    name: "Alice",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Light RP accent, Grade D",
  },
  {
    id: "bf_emma",
    name: "Emma",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Premium narrator, Grade B-",
  },
  {
    id: "bf_isabella",
    name: "Isabella",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Polished neutral, Grade C",
  },
  {
    id: "bf_lily",
    name: "Lily",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Soft & friendly, Grade D",
  },
  {
    id: "bm_daniel",
    name: "Daniel",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Warm storyteller, Grade D",
  },
  {
    id: "bm_fable",
    name: "Fable",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Dramatic baritone, Grade C",
  },
  {
    id: "bm_george",
    name: "George",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Clean RP read, Grade C",
  },
  {
    id: "bm_lewis",
    name: "Lewis",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Relaxed delivery, Grade D+",
  },
];

export const KOKORO_VOICE_GROUPS: KokoroVoiceGroup[] = [
  {
    label: "American English",
    voices: americanVoices,
  },
  {
    label: "British English",
    voices: britishVoices,
  },
];


