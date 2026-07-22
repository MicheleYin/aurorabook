import { describe, expect, it } from "vitest";

import {
  AVAILABLE_LANGS,
  humanizeDurationLocale,
  isAppLanguageCode,
  isTtsLanguageCode,
  normalizeAppLanguage,
  normalizeTtsLanguage,
  UI_LANGS,
  voiceMatchesTtsLanguage,
} from "./languages";

describe("isAppLanguageCode", () => {
  it("accepts all 31 UI locale codes", () => {
    expect(UI_LANGS).toHaveLength(31);
    expect(isAppLanguageCode("en")).toBe(true);
    expect(isAppLanguageCode("ko")).toBe(true);
    expect(isAppLanguageCode("de")).toBe(true);
    expect(isAppLanguageCode("ja")).toBe(true);
    expect(isAppLanguageCode("zz")).toBe(false);
  });
});

describe("normalizeAppLanguage", () => {
  it("returns the code when supported as UI locale", () => {
    expect(normalizeAppLanguage("fr")).toBe("fr");
    expect(normalizeAppLanguage("de")).toBe("de");
    expect(normalizeAppLanguage("pt-BR")).toBe("pt");
  });

  it("falls back to en for missing or unsupported values", () => {
    expect(normalizeAppLanguage(undefined)).toBe("en");
    expect(normalizeAppLanguage(null)).toBe("en");
    expect(normalizeAppLanguage("zz")).toBe("en");
  });
});

describe("isTtsLanguageCode / AVAILABLE_LANGS", () => {
  it("covers all 31 Supertonic 3 languages", () => {
    expect(AVAILABLE_LANGS).toHaveLength(31);
    expect(isTtsLanguageCode("de")).toBe(true);
    expect(isTtsLanguageCode("ja")).toBe(true);
    expect(isTtsLanguageCode("vi")).toBe(true);
    expect(isTtsLanguageCode("na")).toBe(false);
    expect(isTtsLanguageCode("zz")).toBe(false);
  });
});

describe("normalizeTtsLanguage", () => {
  it("accepts BCP-47 tags and base codes", () => {
    expect(normalizeTtsLanguage("de")).toBe("de");
    expect(normalizeTtsLanguage("pt-BR")).toBe("pt");
    expect(normalizeTtsLanguage("ja_JP")).toBe("ja");
  });

  it("falls back to en for missing or unsupported values", () => {
    expect(normalizeTtsLanguage(undefined)).toBe("en");
    expect(normalizeTtsLanguage(null)).toBe("en");
    expect(normalizeTtsLanguage("zz")).toBe("en");
  });
});

describe("voiceMatchesTtsLanguage", () => {
  it("matches multilingual voices and language prefixes", () => {
    expect(voiceMatchesTtsLanguage("mul", "en")).toBe(true);
    expect(voiceMatchesTtsLanguage("en-us", "en")).toBe(true);
    expect(voiceMatchesTtsLanguage("ko", "en")).toBe(false);
  });
});

describe("humanizeDurationLocale", () => {
  it("maps app languages to humanize-duration locales", () => {
    expect(humanizeDurationLocale("ko")).toBe("ko");
    expect(humanizeDurationLocale("de")).toBe("de");
    expect(humanizeDurationLocale("unknown")).toBe("en");
  });
});
