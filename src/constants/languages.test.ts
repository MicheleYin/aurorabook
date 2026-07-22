import { describe, expect, it } from "vitest";

import {
  humanizeDurationLocale,
  isAppLanguageCode,
  normalizeAppLanguage,
  voiceMatchesTtsLanguage,
} from "./languages";

describe("isAppLanguageCode", () => {
  it("accepts supported language codes", () => {
    expect(isAppLanguageCode("en")).toBe(true);
    expect(isAppLanguageCode("ko")).toBe(true);
    expect(isAppLanguageCode("zz")).toBe(false);
  });
});

describe("normalizeAppLanguage", () => {
  it("returns the code when supported", () => {
    expect(normalizeAppLanguage("fr")).toBe("fr");
  });

  it("falls back to en for missing or unsupported values", () => {
    expect(normalizeAppLanguage(undefined)).toBe("en");
    expect(normalizeAppLanguage(null)).toBe("en");
    expect(normalizeAppLanguage("de")).toBe("en");
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
    expect(humanizeDurationLocale("unknown")).toBe("en");
  });
});
