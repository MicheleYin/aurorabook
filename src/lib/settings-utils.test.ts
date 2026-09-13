import { describe, expect, it } from "vitest";

import {
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
    expect(normalizeTtsSynthesisQuality("nope")).toBe("balanced");
  });
});
