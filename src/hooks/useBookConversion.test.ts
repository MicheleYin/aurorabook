import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useBookConversion } from "./useBookConversion";

vi.mock("../context/ConversionStateContext", () => ({
  useConversionState: () => ({
    isConverting: true,
    convertingBookId: "book-1",
    conversionProgress: { currentChapter: 1 },
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
    });
    expect(result.current.convertBook).toBeTypeOf("function");
    expect(result.current.cancelConversion).toBeTypeOf("function");
    expect(result.current.registerCallbacks).toBeTypeOf("function");
  });
});
