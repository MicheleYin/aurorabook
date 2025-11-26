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
    id: "af_alloy",
    name: "Alloy",
    gender: "Female",
    languageTag: "en-US",
    summary: "Bright & steady, Grade C",
    sampleUrl: "voice-samples/af_alloy.mp3",
  },
  {
    id: "af_aoede",
    name: "Aoede",
    gender: "Female",
    languageTag: "en-US",
    summary: "Balanced tone, Grade C+",
    sampleUrl: "voice-samples/af_aoede.mp3",
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
    id: "af_kore",
    name: "Kore",
    gender: "Female",
    languageTag: "en-US",
    summary: "Neutral & calm, Grade C+",
    sampleUrl: "voice-samples/af_kore.mp3",
  },
  {
    id: "af_nicole",
    name: "Nicole",
    gender: "Female",
    languageTag: "en-US",
    summary: "Headphone-ready, Grade B-",
    sampleUrl: "voice-samples/af_nicole.mp3",
  },
  {
    id: "af_nova",
    name: "Nova",
    gender: "Female",
    languageTag: "en-US",
    summary: "Friendly narrator, Grade C",
    sampleUrl: "voice-samples/af_nova.mp3",
  },
  {
    id: "af_river",
    name: "River",
    gender: "Female",
    languageTag: "en-US",
    summary: "Airy light tone, Grade D",
    sampleUrl: "voice-samples/af_river.mp3",
  },
  {
    id: "af_sarah",
    name: "Sarah",
    gender: "Female",
    languageTag: "en-US",
    summary: "Clear generalist, Grade C+",
    sampleUrl: "voice-samples/af_sarah.mp3",
  },
  {
    id: "af_sky",
    name: "Sky",
    gender: "Female",
    languageTag: "en-US",
    summary: "Crisp & bright, Grade C-",
    sampleUrl: "voice-samples/af_sky.mp3",
  },
  {
    id: "am_adam",
    name: "Adam",
    gender: "Male",
    languageTag: "en-US",
    summary: "Casual tenor, Grade F+",
    sampleUrl: "voice-samples/am_adam.mp3",
  },
  {
    id: "am_echo",
    name: "Echo",
    gender: "Male",
    languageTag: "en-US",
    summary: "Even delivery, Grade D",
    sampleUrl: "voice-samples/am_echo.mp3",
  },
  {
    id: "am_eric",
    name: "Eric",
    gender: "Male",
    languageTag: "en-US",
    summary: "Relaxed & warm, Grade D",
    sampleUrl: "voice-samples/am_eric.mp3",
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
    id: "am_liam",
    name: "Liam",
    gender: "Male",
    languageTag: "en-US",
    summary: "Bright tenor, Grade D",
    sampleUrl: "voice-samples/am_liam.mp3",
  },
  {
    id: "am_michael",
    name: "Michael",
    gender: "Male",
    languageTag: "en-US",
    summary: "Presenter feel, Grade C+",
    sampleUrl: "voice-samples/am_michael.mp3",
  },
  {
    id: "am_onyx",
    name: "Onyx",
    gender: "Male",
    languageTag: "en-US",
    summary: "Neutral & modern, Grade D",
    sampleUrl: "voice-samples/am_onyx.mp3",
  },
  {
    id: "am_puck",
    name: "Puck",
    gender: "Male",
    languageTag: "en-US",
    summary: "Playful narrator, Grade C+",
    sampleUrl: "voice-samples/am_puck.mp3",
  },
  {
    id: "am_santa",
    name: "Santa",
    gender: "Male",
    languageTag: "en-US",
    summary: "Cheerful bass, Grade D-",
    sampleUrl: "voice-samples/am_santa.mp3",
  },
];

const britishVoices: KokoroVoiceOption[] = [
  {
    id: "bf_alice",
    name: "Alice",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Light RP accent, Grade D",
    sampleUrl: "voice-samples/bf_alice.mp3",
  },
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
    id: "bf_lily",
    name: "Lily",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Soft & friendly, Grade D",
    sampleUrl: "voice-samples/bf_lily.mp3",
  },
  {
    id: "bm_daniel",
    name: "Daniel",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Warm storyteller, Grade D",
    sampleUrl: "voice-samples/bm_daniel.mp3",
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
  {
    id: "bm_lewis",
    name: "Lewis",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Relaxed delivery, Grade D+",
    sampleUrl: "voice-samples/bm_lewis.mp3",
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


