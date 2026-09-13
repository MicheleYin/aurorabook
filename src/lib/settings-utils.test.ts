import { describe, expect, it } from "vitest";

import {
  defaultTtsSynthesisQuality,
  normalizeAppTab,
  normalizeLibraryViewMode,
  normalizeOptionalBookId,
  normalizeTtsSynthesisQuality,
} from "./settings-utils";

describe("settings-utils", () => {
  it("normalizes app tabs", () => {
    expect(normalizeAppTab("reader")).toBe("reader");
    expect(normalizeAppTab("settings")).toBe("settings");
    expect(normalizeAppTab("nope")).toBe("library");
  });

  it("normalizes library view modes", () => {
    expect(normalizeLibraryViewMode("list")).toBe("list");
    expect(normalizeLibraryViewMode("grid")).toBe("grid");
    expect(normalizeLibraryViewMode("cards")).toBe("grid");
  });

  it("normalizes optional book ids", () => {
    expect(normalizeOptionalBookId("book-1")).toBe("book-1");
    expect(normalizeOptionalBookId("")).toBeNull();
    expect(normalizeOptionalBookId(null)).toBeNull();
  });

  it("normalizes tts quality", () => {
    expect(normalizeTtsSynthesisQuality("quality")).toBe("quality");
    expect(normalizeTtsSynthesisQuality("nope")).toBe(
      defaultTtsSynthesisQuality()
    );
  });

  it("defaults tts quality to fastest on iOS user agents", () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
    try {
      expect(defaultTtsSynthesisQuality()).toBe("fastest");
      expect(normalizeTtsSynthesisQuality("bogus")).toBe("fastest");
    } finally {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: original,
      });
    }
  });
});
