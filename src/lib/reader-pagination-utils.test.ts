import { describe, expect, it } from "vitest";

import {
  getReaderPageCount,
  getReaderPageForRect,
  getReaderPageIndex,
  getReaderPageScrollLeft,
} from "./reader-pagination-utils";

describe("reader pagination utilities", () => {
  it("calculates a minimum-one page count from the content width", () => {
    expect(getReaderPageCount(0, 400)).toBe(1);
    expect(getReaderPageCount(800, 400)).toBe(2);
    expect(getReaderPageCount(801, 400)).toBe(3);
    expect(getReaderPageCount(800, 0)).toBe(1);
  });

  it("maps scroll positions to a clamped current page", () => {
    expect(getReaderPageIndex(0, 400, 3)).toBe(0);
    expect(getReaderPageIndex(410, 400, 3)).toBe(1);
    expect(getReaderPageIndex(4000, 400, 3)).toBe(2);
  });

  it("maps requested pages to their horizontal scroll offsets", () => {
    expect(getReaderPageScrollLeft(1, 400, 3)).toBe(400);
    expect(getReaderPageScrollLeft(8, 400, 3)).toBe(800);
    expect(getReaderPageScrollLeft(-2, 400, 3)).toBe(0);
  });

  it("finds the page containing a word rectangle", () => {
    expect(getReaderPageForRect(450, 100, 0, 400, 3)).toBe(0);
    expect(getReaderPageForRect(250, 100, 400, 400, 3)).toBe(1);
    expect(getReaderPageForRect(900, 100, 800, 400, 3)).toBe(2);
  });
});
