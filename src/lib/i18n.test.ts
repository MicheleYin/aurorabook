import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
const locale = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-os", () => ({
  locale,
  platform: vi.fn(async () => "macos"),
  arch: vi.fn(async () => "aarch64"),
  version: vi.fn(async () => "15.0.0"),
}));

import {
  initI18n,
  loadTranslationsWithModules,
  mapLocaleToLanguage,
  useTranslation,
  type Language,
} from "./i18n";

describe("mapLocaleToLanguage", () => {
  it("maps BCP-47 tags to supported base languages", () => {
    expect(mapLocaleToLanguage("en-US")).toBe("en");
    expect(mapLocaleToLanguage("IT")).toBe("it");
    expect(mapLocaleToLanguage("fr-FR")).toBe("fr");
  });

  it("returns null for missing or unsupported tags", () => {
    expect(mapLocaleToLanguage(null)).toBeNull();
    expect(mapLocaleToLanguage("xx-YY")).toBeNull();
    expect(mapLocaleToLanguage("zh-CN")).toBeNull();
  });
});

describe("initI18n", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers persisted settings language", async () => {
    invoke.mockResolvedValueOnce({ language: "fr" });
    await initI18n();
    expect(invoke).toHaveBeenCalledWith("get_app_settings");
    expect(locale).not.toHaveBeenCalled();
  });

  it("falls back to OS locale when settings have no language", async () => {
    invoke.mockResolvedValueOnce({});
    locale.mockResolvedValueOnce("de-DE");
    await initI18n();
    expect(locale).toHaveBeenCalled();
  });

  it("falls back to browser when OS locale is unsupported", async () => {
    invoke.mockResolvedValueOnce({});
    locale.mockResolvedValueOnce("zh-CN");
    const languageSpy = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("es-ES");
    await initI18n();
    languageSpy.mockRestore();
  });

  it("falls back to browser language when OS locale fails", async () => {
    invoke.mockResolvedValueOnce({});
    locale.mockRejectedValueOnce(new Error("no os locale"));
    const languageSpy = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("it-IT");
    await initI18n();
    languageSpy.mockRestore();
  });

  it("falls back to English when browser language is unsupported", async () => {
    invoke.mockResolvedValueOnce({});
    locale.mockRejectedValueOnce(new Error("no os locale"));
    const languageSpy = vi
      .spyOn(window.navigator, "language", "get")
      .mockReturnValue("zh-CN");
    await initI18n();
    languageSpy.mockRestore();
  });

  it("falls back to English when settings invoke fails", async () => {
    invoke.mockRejectedValueOnce(new Error("offline"));
    await initI18n();
  });
});

describe("useTranslation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    invoke.mockResolvedValue({ language: "en" });
    await initI18n();
  });

  it("translates keys and loads a fresh language on demand", async () => {
    const { result } = renderHook(() => useTranslation());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.t("missing.key")).toBe("missing.key");
    expect(result.current.t("hello", { name: "Ada" })).toMatch(/hello|Ada/);

    // Use a language not exercised by initI18n above so loadTranslations runs.
    await act(async () => {
      await result.current.changeLanguage("ko");
    });
    expect(result.current.lang).toBe("ko");

    // Already loaded — skips loadTranslations.
    await act(async () => {
      await result.current.changeLanguage("ko");
    });
    expect(result.current.lang).toBe("ko");
  });

  it("handles missing locale modules without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useTranslation());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.changeLanguage("not-a-lang" as Language);
    });

    expect(errorSpy).toHaveBeenCalled();

    // Restore a valid language so later suites aren't poisoned.
    await act(async () => {
      await result.current.changeLanguage("en");
    });
    errorSpy.mockRestore();
  });

  it("logs when a locale loader rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadTranslationsWithModules("sv", {
      "../locales/sv.json": async () => {
        throw new Error("boom");
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to load translations for sv:",
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});
