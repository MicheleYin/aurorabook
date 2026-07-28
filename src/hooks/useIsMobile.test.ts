import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useIsMobile } from "./useIsMobile";

describe("useIsMobile", () => {
  it("tracks the sm breakpoint via matchMedia", () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      matches: true,
      media: "(max-width: 639px)",
      addEventListener: vi.fn(
        (_type: string, cb: (event: MediaQueryListEvent) => void) => {
          listener = cb;
        }
      ),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue(mediaQuery),
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);

    act(() => {
      listener?.({ matches: false } as MediaQueryListEvent);
    });
    expect(result.current).toBe(false);
  });

  it("falls back to addListener/resize when addEventListener is missing", () => {
    let legacyListener: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      matches: false,
      media: "(max-width: 639px)",
      addEventListener: undefined as
        | ((type: string, cb: (event: MediaQueryListEvent) => void) => void)
        | undefined,
      removeEventListener: undefined,
      addListener: vi.fn((cb: (event: MediaQueryListEvent) => void) => {
        legacyListener = cb;
      }),
      removeListener: vi.fn(),
    };

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue(mediaQuery),
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 800,
    });

    const addResize = vi.spyOn(window, "addEventListener");
    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    expect(mediaQuery.addListener).toHaveBeenCalled();
    expect(addResize).toHaveBeenCalledWith("resize", expect.any(Function));

    act(() => {
      legacyListener?.({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current).toBe(true);

    unmount();
    expect(mediaQuery.removeListener).toHaveBeenCalled();
  });
});
