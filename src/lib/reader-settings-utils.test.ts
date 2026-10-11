import { describe, expect, it } from "vitest";

import {
  DEFAULT_READER_SETTINGS,
  normalizeContentPadding,
  normalizeFontSize,
} from "./reader-settings-utils";

describe("normalizeFontSize", () => {
  it("maps legacy labels", () => {
    expect(normalizeFontSize("small")).toBe("14");
    expect(normalizeFontSize("medium")).toBe("16");
    expect(normalizeFontSize("large")).toBe("18");
    expect(normalizeFontSize("xlarge")).toBe("20");
  });

  it("clamps numeric values", () => {
    expect(normalizeFontSize("10")).toBe("11");
    expect(normalizeFontSize("30")).toBe("30");
    expect(normalizeFontSize("17.6")).toBe("18");
    expect(normalizeFontSize("37")).toBe("36");
  });

  it("falls back for invalid values", () => {
    expect(normalizeFontSize(undefined)).toBe(DEFAULT_READER_SETTINGS.fontSize);
    expect(normalizeFontSize("huge")).toBe(DEFAULT_READER_SETTINGS.fontSize);
  });
});

describe("normalizeContentPadding", () => {
  it("maps legacy labels", () => {
    expect(normalizeContentPadding("compact")).toBe("16");
    expect(normalizeContentPadding("comfortable")).toBe("24");
    expect(normalizeContentPadding("spacious")).toBe("48");
  });

  it("clamps and rounds numeric padding to even values", () => {
    expect(normalizeContentPadding("7")).toBe("8");
    expect(normalizeContentPadding("65")).toBe("66");
    expect(normalizeContentPadding("25")).toBe("26");
    expect(normalizeContentPadding("129")).toBe("128");
  });

  it("falls back for invalid values", () => {
    expect(normalizeContentPadding(undefined)).toBe(
      DEFAULT_READER_SETTINGS.contentPadding
    );
    expect(normalizeContentPadding("wide")).toBe(
      DEFAULT_READER_SETTINGS.contentPadding
    );
  });
});
