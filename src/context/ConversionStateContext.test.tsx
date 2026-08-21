import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  ConversionStateProvider,
  useConversionState,
} from "./ConversionStateContext";
import {
  emitTauriEvent,
  invoke,
  listen,
  osType,
} from "../test/tauri-mocks";

vi.mock("../lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    lang: "en",
    changeLanguage: vi.fn(),
    loading: false,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <ConversionStateProvider>{children}</ConversionStateProvider>;
}

describe("ConversionStateProvider", () => {
  beforeEach(() => {
    osType.mockReturnValue("macos");
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "get_current_converting_chapter") {
        return null;
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        return {
          id: "book-1",
          title: "Converted",
          author: "A",
          chapters: [],
          sourcePath: "/tmp/a.epub",
          audioTracks: [],
          conversionStatus: "done",
          completedChapters: [],
        };
      }
      if (cmd === "cancel_conversion_command") {
        return undefined;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useConversionState())).toThrow(
      /must be used within a ConversionStateProvider/
    );
  });

  it("registers conversion event listeners on mount", async () => {
    renderHook(() => useConversionState(), { wrapper });

    await waitFor(() => {
      const events = listen.mock.calls.map((c) => c[0]);
      expect(events).toEqual(
        expect.arrayContaining([
          "conversion-progress",
          "chapter-completed",
          "conversion-cancelled",
          "background-task-expired",
          "background-task-completed",
        ])
      );
    });
  });

  it("starts a conversion and completes when the command returns a book", async () => {
    const onComplete = vi.fn();
    const onStarted = vi.fn();
    const { result } = renderHook(() => useConversionState(), { wrapper });

    act(() => {
      result.current.registerCallbacks({
        onConversionComplete: onComplete,
        onConversionStarted: onStarted,
      });
    });

    await act(async () => {
      await result.current.convertBook("book-1", "en", "F1");
    });

    expect(onStarted).toHaveBeenCalledWith("book-1");
    expect(invoke).toHaveBeenCalledWith(
      "convert_epub_to_audiobook_command",
      expect.objectContaining({
        bookId: "book-1",
        voiceId: "F1",
        language: "en",
      })
    );
    expect(onComplete).toHaveBeenCalled();
    expect(result.current.isConverting).toBe(false);
    expect(toast.success).toHaveBeenCalledWith(
      "Conversion complete!",
      expect.anything()
    );
  });

  it("updates progress from conversion-progress events", async () => {
    let resolveConvert: (value: null) => void = () => undefined;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        return new Promise<null>((resolve) => {
          resolveConvert = resolve;
        });
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    await waitFor(() => {
      expect(listen.mock.calls.some((c) => c[0] === "conversion-progress")).toBe(
        true
      );
    });

    let convertPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      convertPromise = result.current.convertBook("book-1");
    });

    await waitFor(() => {
      expect(result.current.isConverting).toBe(true);
    });

    act(() => {
      emitTauriEvent("conversion-progress", {
        currentChapter: 1,
        totalChapters: 4,
        wordsProcessed: 250,
        totalWords: 1000,
        wordsInCurrentChapter: 250,
        currentStep: "tts",
        message: "Speaking",
      });
    });

    await waitFor(() => {
      expect(result.current.conversionProgress?.wordsProcessed).toBe(250);
      expect(result.current.eta).toEqual(expect.any(String));
    });

    await act(async () => {
      resolveConvert(null);
      await convertPromise;
    });
  });

  it("handles conversion-cancelled events and notifies callbacks", async () => {
    const onCancelled = vi.fn();
    const { result } = renderHook(() => useConversionState(), { wrapper });

    act(() => {
      result.current.registerCallbacks({ onConversionCancelled: onCancelled });
    });

    await waitFor(() => {
      expect(
        listen.mock.calls.some((c) => c[0] === "conversion-cancelled")
      ).toBe(true);
    });

    act(() => {
      emitTauriEvent("conversion-cancelled", {
        bookId: "book-1",
        sourcePath: "/tmp/a.epub",
      });
    });

    await waitFor(() => {
      expect(onCancelled).toHaveBeenCalledWith("book-1");
      expect(result.current.isConverting).toBe(false);
    });
    expect(toast.error).toHaveBeenCalled();
  });

  it("requests cancellation via the backend command", async () => {
    const { result } = renderHook(() => useConversionState(), { wrapper });

    await act(async () => {
      await result.current.cancelConversion("book-1");
    });

    expect(invoke).toHaveBeenCalledWith("cancel_conversion_command", {
      bookId: "book-1",
    });
    expect(toast.info).toHaveBeenCalledWith("Cancellation requested...");
  });

  it("notifies chapter-completed callbacks", async () => {
    const onChapter = vi.fn();
    const { result } = renderHook(() => useConversionState(), { wrapper });

    act(() => {
      result.current.registerCallbacks({ onChapterCompleted: onChapter });
    });

    await waitFor(() => {
      expect(listen.mock.calls.some((c) => c[0] === "chapter-completed")).toBe(
        true
      );
    });

    act(() => {
      emitTauriEvent("chapter-completed", {
        bookId: "book-1",
        sourcePath: "/tmp/a.epub",
        chapterIndex: 1,
        totalChapters: 3,
        chapterTitle: "Intro",
        audioGenerated: true,
      });
    });

    expect(onChapter).toHaveBeenCalledWith("book-1");
    expect(toast.success).toHaveBeenCalled();
  });

  it("starts continued processing on iOS when supported", async () => {
    osType.mockReturnValue("ios");
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "background_capabilities") {
        return { supportsContinuedProcessing: true, isIos: true };
      }
      if (cmd === "start_continued_conversion") {
        return {
          jobId: "j1",
          taskId: "t1",
          bookId: "book-1",
          continuedProcessing: true,
        };
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        return null;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    await act(async () => {
      await result.current.convertBook("book-1");
    });

    expect(invoke).toHaveBeenCalledWith(
      "start_continued_conversion",
      expect.objectContaining({ bookId: "book-1" })
    );
    expect(toast.message).toHaveBeenCalled();
  });

  it("ignores duplicate convert requests for the same book", async () => {
    let resolveConvert: (value: null) => void = () => undefined;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        return new Promise<null>((resolve) => {
          resolveConvert = resolve;
        });
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.convertBook("book-1");
    });
    await waitFor(() => expect(result.current.isConverting).toBe(true));

    await act(async () => {
      await result.current.convertBook("book-1");
    });

    // Still only one convert command in flight.
    expect(
      invoke.mock.calls.filter(
        (c) => c[0] === "convert_epub_to_audiobook_command"
      )
    ).toHaveLength(1);

    await act(async () => {
      resolveConvert(null);
      await first;
    });
  });

  it("rejects starting a different book while one is converting", async () => {
    let resolveConvert: (value: null) => void = () => undefined;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "get_current_converting_chapter") {
        return null;
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        return new Promise<null>((resolve) => {
          resolveConvert = resolve;
        });
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.convertBook("book-1");
    });
    await waitFor(() => expect(result.current.isConverting).toBe(true));

    await act(async () => {
      await result.current.convertBook("book-2");
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Another conversion is already in progress"
    );
    expect(result.current.convertingBookId).toBe("book-1");
    expect(
      invoke.mock.calls.filter(
        (c) => c[0] === "convert_epub_to_audiobook_command"
      )
    ).toHaveLength(1);

    await act(async () => {
      resolveConvert(null);
      await first;
    });
  });

  it("falls through when iOS continued processing is unsupported", async () => {
    osType.mockReturnValue("ios");
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "background_capabilities") {
        return { supportsContinuedProcessing: false, isIos: true };
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        return null;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    await act(async () => {
      await result.current.convertBook("book-1");
    });

    expect(invoke).not.toHaveBeenCalledWith(
      "start_continued_conversion",
      expect.anything()
    );
    expect(invoke).toHaveBeenCalledWith(
      "convert_epub_to_audiobook_command",
      expect.objectContaining({ bookId: "book-1" })
    );
  });

  it("continues in-process when iOS background setup throws", async () => {
    osType.mockReturnValue("ios");
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "background_capabilities") {
        throw new Error("bg unavailable");
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        return null;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    await act(async () => {
      await result.current.convertBook("book-1");
    });

    expect(invoke).toHaveBeenCalledWith(
      "convert_epub_to_audiobook_command",
      expect.objectContaining({ bookId: "book-1" })
    );
  });

  it("surfaces convert failures and clears converting state", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        throw new Error("TTS engine crashed");
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    await act(async () => {
      await result.current.convertBook("book-1");
    });

    expect(toast.error).toHaveBeenCalledWith("TTS engine crashed", {
      id: "conversion-book-1",
    });
    expect(result.current.isConverting).toBe(false);
    expect(result.current.convertingBookId).toBeNull();
  });

  it("surfaces cancel failures", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "cancel_conversion_command") {
        throw new Error("cancel refused");
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    await act(async () => {
      await result.current.cancelConversion("book-1");
    });

    expect(toast.error).toHaveBeenCalledWith("cancel refused");
  });

  it("no-ops cancel when bookId is null", async () => {
    const { result } = renderHook(() => useConversionState(), { wrapper });

    await act(async () => {
      await result.current.cancelConversion(null);
    });

    expect(invoke).not.toHaveBeenCalledWith(
      "cancel_conversion_command",
      expect.anything()
    );
  });

  describe("live converting chapter tracking", () => {
    async function startOpenConversion(
      result: { current: ReturnType<typeof useConversionState> },
      liveChapter: number | null = 0
    ) {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { ttsVoiceId: "F1", ttsLanguage: "en" };
        }
        if (cmd === "get_current_converting_chapter") {
          return liveChapter;
        }
        if (cmd === "convert_epub_to_audiobook_command") {
          // Leave conversion "in progress" so live-chapter event handlers stay active.
          return null;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      await act(async () => {
        await result.current.convertBook("book-1");
      });
      await waitFor(() => {
        expect(result.current.isConverting).toBe(true);
        expect(result.current.convertingBookId).toBe("book-1");
      });
    }

    it("refreshes and stores the current converting chapter from the backend", async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_current_converting_chapter") {
          return 2;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      const { result } = renderHook(() => useConversionState(), { wrapper });

      expect(result.current.getCurrentConvertingChapter("book-1")).toBeNull();

      let chapter: number | null = null;
      await act(async () => {
        chapter = await result.current.refreshCurrentConvertingChapter("book-1");
      });

      expect(chapter).toBe(2);
      expect(invoke).toHaveBeenCalledWith("get_current_converting_chapter", {
        bookId: "book-1",
      });
      expect(result.current.getCurrentConvertingChapter("book-1")).toBe(2);
      expect(result.current.currentConvertingChapterByBook["book-1"]).toBe(2);
      expect(result.current.getCurrentConvertingChapter("other-book")).toBeNull();
    });

    it("returns null when refreshing an empty book id", async () => {
      const { result } = renderHook(() => useConversionState(), { wrapper });

      let chapter: number | null = -1;
      await act(async () => {
        chapter = await result.current.refreshCurrentConvertingChapter("");
      });

      expect(chapter).toBeNull();
      expect(invoke).not.toHaveBeenCalledWith(
        "get_current_converting_chapter",
        expect.anything()
      );
    });

    it("keeps prior chapter state when the backend refresh fails", async () => {
      const { result } = renderHook(() => useConversionState(), { wrapper });

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_current_converting_chapter") {
          return 1;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      await act(async () => {
        await result.current.refreshCurrentConvertingChapter("book-1");
      });
      expect(result.current.getCurrentConvertingChapter("book-1")).toBe(1);

      invoke.mockImplementation(async () => {
        throw new Error("checkpoint unavailable");
      });

      let chapter: number | null = -1;
      await act(async () => {
        chapter = await result.current.refreshCurrentConvertingChapter("book-1");
      });

      expect(chapter).toBeNull();
      expect(result.current.getCurrentConvertingChapter("book-1")).toBe(1);
    });

    it("seeds live chapter state when conversion starts", async () => {
      const { result } = renderHook(() => useConversionState(), { wrapper });

      await startOpenConversion(result, 0);

      expect(result.current.getCurrentConvertingChapter("book-1")).toBe(0);
      expect(invoke).toHaveBeenCalledWith("get_current_converting_chapter", {
        bookId: "book-1",
      });
    });

    it("updates the live chapter from conversion-progress events", async () => {
      const { result } = renderHook(() => useConversionState(), { wrapper });
      await startOpenConversion(result, 0);

      await waitFor(() => {
        expect(listen.mock.calls.some((c) => c[0] === "conversion-progress")).toBe(
          true
        );
      });

      act(() => {
        emitTauriEvent("conversion-progress", {
          currentChapter: 2,
          totalChapters: 5,
          wordsProcessed: 400,
          totalWords: 1000,
          wordsInCurrentChapter: 100,
          currentStep: "tts",
          message: "Speaking chapter 2",
        });
      });

      await waitFor(() => {
        // currentChapter is 1-indexed in progress payloads; live index is 0-based.
        expect(result.current.getCurrentConvertingChapter("book-1")).toBe(1);
      });
    });

    it("ignores regressive live chapter jumps from noisy progress", async () => {
      const { result } = renderHook(() => useConversionState(), { wrapper });
      await startOpenConversion(result, 0);

      act(() => {
        emitTauriEvent("conversion-progress", {
          currentChapter: 3,
          totalChapters: 5,
          wordsProcessed: 600,
          totalWords: 1000,
          wordsInCurrentChapter: 100,
          currentStep: "tts",
          message: "Speaking",
        });
      });
      await waitFor(() => {
        expect(result.current.getCurrentConvertingChapter("book-1")).toBe(2);
      });

      act(() => {
        emitTauriEvent("conversion-progress", {
          currentChapter: 1,
          totalChapters: 5,
          wordsProcessed: 650,
          totalWords: 1000,
          wordsInCurrentChapter: 50,
          currentStep: "tts",
          message: "Noisy regress",
        });
      });

      await waitFor(() => {
        expect(result.current.conversionProgress?.message).toBe("Noisy regress");
      });
      expect(result.current.getCurrentConvertingChapter("book-1")).toBe(2);
    });

    it("optimistically advances on chapter-completed and reconciles with backend", async () => {
      const { result } = renderHook(() => useConversionState(), { wrapper });
      await startOpenConversion(result, 0);

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_current_converting_chapter") {
          return 1;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      await waitFor(() => {
        expect(listen.mock.calls.some((c) => c[0] === "chapter-completed")).toBe(
          true
        );
      });

      act(() => {
        emitTauriEvent("chapter-completed", {
          bookId: "book-1",
          sourcePath: "/tmp/a.epub",
          chapterIndex: 1,
          totalChapters: 4,
          chapterTitle: "Intro",
          audioGenerated: true,
        });
      });

      await waitFor(() => {
        expect(result.current.getCurrentConvertingChapter("book-1")).toBe(1);
      });
      expect(invoke).toHaveBeenCalledWith("get_current_converting_chapter", {
        bookId: "book-1",
      });
    });

    it("clears live chapter state when conversion completes", async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { ttsVoiceId: "F1", ttsLanguage: "en" };
        }
        if (cmd === "get_current_converting_chapter") {
          return 0;
        }
        if (cmd === "convert_epub_to_audiobook_command") {
          return {
            id: "book-1",
            title: "Converted",
            author: "A",
            chapters: [],
            sourcePath: "/tmp/a.epub",
            audioTracks: [],
            conversionStatus: "done",
            completedChapters: [],
          };
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      const { result } = renderHook(() => useConversionState(), { wrapper });

      await act(async () => {
        await result.current.convertBook("book-1");
      });

      expect(result.current.isConverting).toBe(false);
      expect(result.current.getCurrentConvertingChapter("book-1")).toBeNull();
    });

    it("keeps live chapter discoverable after cancel when checkpoint remains", async () => {
      const { result } = renderHook(() => useConversionState(), { wrapper });

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { ttsVoiceId: "F1", ttsLanguage: "en" };
        }
        if (cmd === "get_current_converting_chapter") {
          // After cancel, backend still returns playable paused checkpoint.
          return 0;
        }
        if (cmd === "convert_epub_to_audiobook_command") {
          return null;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      await act(async () => {
        await result.current.convertBook("book-1");
      });
      await waitFor(() => {
        expect(result.current.getCurrentConvertingChapter("book-1")).toBe(0);
      });

      act(() => {
        emitTauriEvent("conversion-cancelled", {
          bookId: "book-1",
          sourcePath: "/tmp/a.epub",
        });
      });

      await waitFor(() => {
        expect(result.current.isConverting).toBe(false);
        expect(result.current.getCurrentConvertingChapter("book-1")).toBe(0);
      });
    });

    it("clears live chapter state when conversion is cancelled without checkpoint", async () => {
      const { result } = renderHook(() => useConversionState(), { wrapper });
      await startOpenConversion(result, 0);

      expect(result.current.getCurrentConvertingChapter("book-1")).toBe(0);

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_current_converting_chapter") {
          return null;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      act(() => {
        emitTauriEvent("conversion-cancelled", {
          bookId: "book-1",
          sourcePath: "/tmp/a.epub",
        });
      });

      await waitFor(() => {
        expect(result.current.getCurrentConvertingChapter("book-1")).toBeNull();
        expect(result.current.isConverting).toBe(false);
      });
    });
  });
  it("estimates ETA from remaining session work when resuming", async () => {
    let resolveConvert: (value: unknown) => void = () => undefined;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { ttsVoiceId: "F1", ttsLanguage: "en" };
      }
      if (cmd === "get_current_converting_chapter") {
        return 3;
      }
      if (cmd === "convert_epub_to_audiobook_command") {
        return await new Promise((resolve) => {
          resolveConvert = resolve;
        });
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useConversionState(), { wrapper });

    let convertPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      convertPromise = result.current.convertBook("book-1");
    });

    await waitFor(() => {
      expect(result.current.isConverting).toBe(true);
    });

    // Resume mid-book: 800/1000 words already done before this session.
    // Without baseline, ETA would collapse toward ~0s because session time is tiny.
    act(() => {
      emitTauriEvent("conversion-progress", {
        currentChapter: 4,
        totalChapters: 5,
        wordsProcessed: 800,
        totalWords: 1000,
        wordsInCurrentChapter: 0,
        currentStep: "initializing",
        message: "Resuming",
        sessionBaselineWords: 800,
        priorElapsedMs: 800_000, // ~1s/word historically
      });
    });

    await waitFor(() => {
      expect(result.current.eta).toEqual(expect.any(String));
      // 200 remaining words * 1000ms ≈ 3–4 minutes, not "0 seconds".
      expect(result.current.eta).not.toMatch(/^0\s/);
      expect(result.current.eta?.toLowerCase()).toMatch(/minute|min/);
    });

    act(() => {
      emitTauriEvent("conversion-progress", {
        currentChapter: 4,
        totalChapters: 5,
        wordsProcessed: 850,
        totalWords: 1000,
        wordsInCurrentChapter: 50,
        currentStep: "tts",
        message: "Speaking",
        sessionBaselineWords: 800,
        priorElapsedMs: 800_000,
      });
    });

    await waitFor(() => {
      expect(result.current.conversionProgress?.wordsProcessed).toBe(850);
      expect(result.current.eta).toEqual(expect.any(String));
      expect(result.current.eta).not.toMatch(/^0\s/);
    });

    await act(async () => {
      resolveConvert(null);
      await convertPromise;
    });
  });
});
