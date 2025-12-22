import type { VoiceId } from "../types/reader";

export const DEFAULT_KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_KOKORO_VOICE_ID: VoiceId = "af_heart";
export const KOKORO_MODEL_CARD_URL = `https://huggingface.co/${DEFAULT_KOKORO_MODEL_ID}`;
export const KOKORO_VOICE_DATASET_URL =
  "https://huggingface.co/datasets/hexgrad/Kokoro-voices";

export type KokoroVoiceOption = {
  id: VoiceId;
  name: string;
  gender: "Female" | "Male";
  languageTag: string;
  summary: string;
  sampleUrl: string;
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
    sampleUrl: "voice-samples/af_heart.mp3",
  },

  {
    id: "af_bella",
    name: "Bella",
    gender: "Female",
    languageTag: "en-US",
    summary: "Warm storyteller, Grade A-",
    sampleUrl: "voice-samples/af_bella.mp3",
  },
  {
    id: "af_jessica",
    name: "Jessica",
    gender: "Female",
    languageTag: "en-US",
    summary: "Soft conversational, Grade D",
    sampleUrl: "voice-samples/af_jessica.mp3",
  },

  {
    id: "am_fenrir",
    name: "Fenrir",
    gender: "Male",
    languageTag: "en-US",
    summary: "Deep & bold, Grade C+",
    sampleUrl: "voice-samples/am_fenrir.mp3",
  },

  {
    id: "am_michael",
    name: "Michael",
    gender: "Male",
    languageTag: "en-US",
    summary: "Presenter feel, Grade C+",
    sampleUrl: "voice-samples/am_michael.mp3",
  },
];

const britishVoices: KokoroVoiceOption[] = [
  {
    id: "bf_emma",
    name: "Emma",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Premium narrator, Grade B-",
    sampleUrl: "voice-samples/bf_emma.mp3",
  },
  {
    id: "bf_isabella",
    name: "Isabella",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Polished neutral, Grade C",
    sampleUrl: "voice-samples/bf_isabella.mp3",
  },
  {
    id: "bm_fable",
    name: "Fable",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Dramatic baritone, Grade C",
    sampleUrl: "voice-samples/bm_fable.mp3",
  },
  {
    id: "bm_george",
    name: "George",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Clean RP read, Grade C",
    sampleUrl: "voice-samples/bm_george.mp3",
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
