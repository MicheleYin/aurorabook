import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useBookConversion } from "./useBookConversion";

const getCurrentConvertingChapter = vi.fn(() => 1);
const refreshCurrentConvertingChapter = vi.fn(async () => 1);

vi.mock("../context/ConversionStateContext", () => ({
  useConversionState: () => ({
    isConverting: true,
    convertingBookId: "book-1",
    conversionProgress: { currentChapter: 1 },
    currentConvertingChapterByBook: { "book-1": 1 },
    getCurrentConvertingChapter,
    refreshCurrentConvertingChapter,
    eta: "1m",
    convertBook: vi.fn(),
    cancelConversion: vi.fn(),
    registerCallbacks: vi.fn(),
  }),
}));

describe("useBookConversion", () => {
  it("exposes conversion state from ConversionStateContext", () => {
    const { result } = renderHook(() => useBookConversion());
    expect(result.current).toMatchObject({
      isConverting: true,
      convertingBookId: "book-1",
      eta: "1m",
      currentConvertingChapterByBook: { "book-1": 1 },
    });
    expect(result.current.convertBook).toBeTypeOf("function");
    expect(result.current.cancelConversion).toBeTypeOf("function");
    expect(result.current.registerCallbacks).toBeTypeOf("function");
  });

  it("exposes live converting chapter helpers", () => {
    const { result } = renderHook(() => useBookConversion());

    expect(result.current.getCurrentConvertingChapter("book-1")).toBe(1);
    expect(result.current.refreshCurrentConvertingChapter).toBe(
      refreshCurrentConvertingChapter
    );
  });
});
