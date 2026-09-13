import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyThemeToDocument,
  clearPreferredThemesForTests,
  getPreferredDarkTheme,
  getPreferredLightTheme,
  rememberPreferredTheme,
  resolveColorTheme,
  themeClassNames,
} from "./theme";

describe("theme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    clearPreferredThemesForTests();
  });

  it("remembers last light and dark themes for system mode", () => {
    applyThemeToDocument("cream");
    expect(getPreferredLightTheme()).toBe("cream");
    expect(document.documentElement.classList.contains("theme-cream")).toBe(
      true
    );
    expect(document.documentElement.classList.contains("light")).toBe(true);

    applyThemeToDocument("pitch");
    expect(getPreferredDarkTheme()).toBe("pitch");
    expect(document.documentElement.classList.contains("theme-pitch")).toBe(
      true
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark"),
        media: query,
      })),
    });

    expect(resolveColorTheme("system")).toBe("pitch");

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
      })),
    });

    expect(resolveColorTheme("system")).toBe("cream");

    applyThemeToDocument("system");
    expect(document.documentElement.classList.contains("theme-cream")).toBe(
      true
    );
  });

  it("maps theme ids to CSS class names", () => {
    expect(themeClassNames("cream")).toBe("light theme-cream");
    expect(themeClassNames("pitch")).toBe("dark theme-pitch");
    expect(themeClassNames("dark")).toBe("dark");
    expect(themeClassNames("system")).toBe("");
  });
});
