export const DEFAULT_KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_KOKORO_VOICE_ID = "af_heart";
export const KOKORO_MODEL_CARD_URL = `https://huggingface.co/${DEFAULT_KOKORO_MODEL_ID}`;
export const KOKORO_VOICE_DATASET_URL =
  "https://huggingface.co/datasets/hexgrad/Kokoro-voices";

export type KokoroVoiceOption = {
  id: string;
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
    summary: "Expressive & default, Grade A",
    sampleUrl: "voice-samples/af_heart.mp3",
  },
  {
    id: "af_alloy",
    name: "Alloy",
    gender: "Female",
    languageTag: "en-US",
    summary: "Versatile conversational, Grade A-",
    sampleUrl: "voice-samples/af_alloy.mp3",
  },
  {
    id: "af_aoede",
    name: "Aoede",
    gender: "Female",
    languageTag: "en-US",
    summary: "Warm storyteller, Grade A-",
    sampleUrl: "voice-samples/af_aoede.mp3",
  },
  {
    id: "af_bella",
    name: "Bella",
    gender: "Female",
    languageTag: "en-US",
    summary: "Clear & engaging, Grade A-",
    sampleUrl: "voice-samples/af_bella.mp3",
  },
  {
    id: "af_jessica",
    name: "Jessica",
    gender: "Female",
    languageTag: "en-US",
    summary: "Casual & soft, Grade D",
    sampleUrl: "voice-samples/af_jessica.mp3",
  },
  {
    id: "af_kore",
    name: "Kore",
    gender: "Female",
    languageTag: "en-US",
    summary: "Polished announcer, Grade B-",
    sampleUrl: "voice-samples/af_kore.mp3",
  },
  {
    id: "af_nicole",
    name: "Nicole",
    gender: "Female",
    languageTag: "en-US",
    summary: "Professional neutral, Grade B-",
    sampleUrl: "voice-samples/af_nicole.mp3",
  },
  {
    id: "af_nova",
    name: "Nova",
    gender: "Female",
    languageTag: "en-US",
    summary: "Dynamic narrating, Grade B-",
    sampleUrl: "voice-samples/af_nova.mp3",
  },
  {
    id: "af_river",
    name: "River",
    gender: "Female",
    languageTag: "en-US",
    summary: "Friendly conversational, Grade B-",
    sampleUrl: "voice-samples/af_river.mp3",
  },
  {
    id: "af_sarah",
    name: "Sarah",
    gender: "Female",
    languageTag: "en-US",
    summary: "Bright & energetic, Grade B-",
    sampleUrl: "voice-samples/af_sarah.mp3",
  },
  {
    id: "af_sky",
    name: "Sky",
    gender: "Female",
    languageTag: "en-US",
    summary: "Smooth & gentle, Grade B-",
    sampleUrl: "voice-samples/af_sky.mp3",
  },
  {
    id: "am_adam",
    name: "Adam",
    gender: "Male",
    languageTag: "en-US",
    summary: "Deep & professional, Grade C",
    sampleUrl: "voice-samples/am_adam.mp3",
  },
  {
    id: "am_echo",
    name: "Echo",
    gender: "Male",
    languageTag: "en-US",
    summary: "Warm storyteller, Grade C",
    sampleUrl: "voice-samples/am_echo.mp3",
  },
  {
    id: "am_eric",
    name: "Eric",
    gender: "Male",
    languageTag: "en-US",
    summary: "Clear conversational, Grade C",
    sampleUrl: "voice-samples/am_eric.mp3",
  },
  {
    id: "am_fenrir",
    name: "Fenrir",
    gender: "Male",
    languageTag: "en-US",
    summary: "Bold & commanding, Grade C+",
    sampleUrl: "voice-samples/am_fenrir.mp3",
  },
  {
    id: "am_liam",
    name: "Liam",
    gender: "Male",
    languageTag: "en-US",
    summary: "Friendly narrator, Grade C",
    sampleUrl: "voice-samples/am_liam.mp3",
  },
  {
    id: "am_michael",
    name: "Michael",
    gender: "Male",
    languageTag: "en-US",
    summary: "Academic presenter, Grade C+",
    sampleUrl: "voice-samples/am_michael.mp3",
  },
  {
    id: "am_onyx",
    name: "Onyx",
    gender: "Male",
    languageTag: "en-US",
    summary: "Stealthy & deep, Grade C",
    sampleUrl: "voice-samples/am_onyx.mp3",
  },
  {
    id: "am_puck",
    name: "Puck",
    gender: "Male",
    languageTag: "en-US",
    summary: "Lighthearted read, Grade C",
    sampleUrl: "voice-samples/am_puck.mp3",
  },
  {
    id: "am_santa",
    name: "Santa",
    gender: "Male",
    languageTag: "en-US",
    summary: "Jolly & festive, Grade C",
    sampleUrl: "voice-samples/am_santa.mp3",
  },
];

const britishVoices: KokoroVoiceOption[] = [
  {
    id: "bf_alice",
    name: "Alice",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Polished RP, Grade C",
    sampleUrl: "voice-samples/bf_alice.mp3",
  },
  {
    id: "bf_emma",
    name: "Emma",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Premium British read, Grade B-",
    sampleUrl: "voice-samples/bf_emma.mp3",
  },
  {
    id: "bf_isabella",
    name: "Isabella",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Neutral reporter, Grade C",
    sampleUrl: "voice-samples/bf_isabella.mp3",
  },
  {
    id: "bf_lily",
    name: "Lily",
    gender: "Female",
    languageTag: "en-GB",
    summary: "Soft & inviting, Grade C",
    sampleUrl: "voice-samples/bf_lily.mp3",
  },
  {
    id: "bm_daniel",
    name: "Daniel",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Refined narrator, Grade C",
    sampleUrl: "voice-samples/bm_daniel.mp3",
  },
  {
    id: "bm_fable",
    name: "Fable",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Theatrical baritone, Grade C",
    sampleUrl: "voice-samples/bm_fable.mp3",
  },
  {
    id: "bm_george",
    name: "George",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Classic RP read, Grade C",
    sampleUrl: "voice-samples/bm_george.mp3",
  },
  {
    id: "bm_lewis",
    name: "Lewis",
    gender: "Male",
    languageTag: "en-GB",
    summary: "Distinctive tone, Grade C",
    sampleUrl: "voice-samples/bm_lewis.mp3",
  },
];

const spanishVoices: KokoroVoiceOption[] = [
  {
    id: "ef_dora",
    name: "Dora",
    gender: "Female",
    languageTag: "es-ES",
    summary: "Voz femenina natural",
    sampleUrl: "voice-samples/ef_dora.mp3",
  },
  {
    id: "em_alex",
    name: "Alex",
    gender: "Male",
    languageTag: "es-ES",
    summary: "Voz masculina profunda",
    sampleUrl: "voice-samples/em_alex.mp3",
  },
  {
    id: "em_santa",
    name: "Santa",
    gender: "Male",
    languageTag: "es-ES",
    summary: "Voz festiva española",
    sampleUrl: "voice-samples/em_santa.mp3",
  },
];

const italianVoices: KokoroVoiceOption[] = [
  {
    id: "if_sara",
    name: "Sara",
    gender: "Female",
    languageTag: "it-IT",
    summary: "Voce naturale italiana",
    sampleUrl: "voice-samples/if_sara.mp3",
  },
  {
    id: "im_nicola",
    name: "Nicola",
    gender: "Male",
    languageTag: "it-IT",
    summary: "Voce calma e chiara",
    sampleUrl: "voice-samples/im_nicola.mp3",
  },
];

const chineseVoices: KokoroVoiceOption[] = [
  {
    id: "zf_xiaoxiao",
    name: "Xiaoxiao",
    gender: "Female",
    languageTag: "zh-CN",
    summary: "亲切悦耳的女声",
    sampleUrl: "voice-samples/zf_xiaoxiao.mp3",
  },
  {
    id: "zf_xiaobei",
    name: "Xiaobei",
    gender: "Female",
    languageTag: "zh-CN",
    summary: "活泼自然的少女音",
    sampleUrl: "voice-samples/zf_xiaobei.mp3",
  },
  {
    id: "zf_xiaoni",
    name: "Xiaoni",
    gender: "Female",
    languageTag: "zh-CN",
    summary: "温柔细腻的嗓音",
    sampleUrl: "voice-samples/zf_xiaoni.mp3",
  },
  {
    id: "zf_xiaoyi",
    name: "Xiaoyi",
    gender: "Female",
    languageTag: "zh-CN",
    summary: "舒缓的解说音",
    sampleUrl: "voice-samples/zf_xiaoyi.mp3",
  },
  {
    id: "zm_yunxi",
    name: "Yunxi",
    gender: "Male",
    languageTag: "zh-CN",
    summary: "稳重自然的男声",
    sampleUrl: "voice-samples/zm_yunxi.mp3",
  },
  {
    id: "zm_yunjian",
    name: "Yunjian",
    gender: "Male",
    languageTag: "zh-CN",
    summary: "沉稳睿智的嗓音",
    sampleUrl: "voice-samples/zm_yunjian.mp3",
  },
  {
    id: "zm_yunxia",
    name: "Yunxia",
    gender: "Male",
    languageTag: "zh-CN",
    summary: "清亮少年的口气",
    sampleUrl: "voice-samples/zm_yunxia.mp3",
  },
  {
    id: "zm_yunyang",
    name: "Yunyang",
    gender: "Male",
    languageTag: "zh-CN",
    summary: "成熟稳重的播报音",
    sampleUrl: "voice-samples/zm_yunyang.mp3",
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
  {
    label: "Spanish",
    voices: spanishVoices,
  },
  {
    label: "Italian",
    voices: italianVoices,
  },
  {
    label: "Chinese",
    voices: chineseVoices,
  },
];
