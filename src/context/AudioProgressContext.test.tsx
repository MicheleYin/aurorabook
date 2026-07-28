import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import {
  AudioProgressProvider,
  useAudioProgressContext,
} from "./AudioProgressContext";
import type { AudioTrack, Book } from "../types/book";
import {
  emitTauriEvent,
  invoke,
  listen,
  osType,
} from "../test/tauri-mocks";

function createTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: "track-1",
    bookId: "book-1",
    chapterHref: "ch1.xhtml",
    filePath: "audio/01.mp3",
    href: "audio/01.mp3",
    title: "Intro",
    order: 0,
    duration: 120,
    ...overrides,
  };
}

function createBook(overrides: Partial<Book> = {}): Book {
  const track = createTrack();
  return {
    id: "book-1",
    title: "Test Book",
    author: "Author",
    chapters: [
      {
        id: "ch-1",
        bookId: "book-1",
        title: "Chapter 1",
        href: "ch1.xhtml",
        chapterOrder: 0,
      },
    ],
    sourcePath: "/tmp/book.epub",
    audioTracks: [track],
    conversionStatus: "completed",
    completedChapters: [],
    audioSyncMap: {
      segments: [
        {
          textElementId: "w1",
          chapterHref: "ch1.xhtml",
          audioTrackHref: "audio/01.mp3",
          clipBegin: 0,
          clipEnd: 10,
        },
      ],
    },
    ...overrides,
  };
}

function createAudioElement(): HTMLAudioElement {
  const audio = document.createElement("audio");
  Object.defineProperties(audio, {
    play: {
      configurable: true,
      value: vi.fn(async () => undefined),
    },
    pause: {
      configurable: true,
      value: vi.fn(),
    },
    load: {
      configurable: true,
      value: vi.fn(),
    },
    paused: {
      configurable: true,
      get: () => true,
    },
    duration: {
      configurable: true,
      get: () => 120,
    },
  });
  return audio;
}

function wrapper({ children }: { children: ReactNode }) {
  return <AudioProgressProvider>{children}</AudioProgressProvider>;
}

describe("AudioProgressProvider", () => {
  beforeEach(() => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { audioPlaybackSpeed: 1.25 };
      }
      if (cmd === "get_audio_stream_url") {
        return "https://stream.local/track.mp3";
      }
      if (cmd === "update_book_audio_state") {
        return undefined;
      }
      if (cmd.startsWith("ios_player_")) {
        return cmd === "ios_player_is_playing" ? false : undefined;
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useAudioProgressContext())).toThrow(
      /must be used within AudioProgressProvider/
    );
  });

  it("loads playback speed from settings on mount", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.playbackRate).toBe(1.25);
    });
  });

  it("loads an audio track and exposes progress helpers", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const book = createBook();
    const track = book.audioTracks[0];

    await act(async () => {
      await result.current.loadAudioTrack(book.id, track, book);
    });

    expect(result.current.currentAudioTrack?.id).toBe("track-1");
    expect(result.current.currentAudioTrack?.mimeType).toBe("audio/mpeg");
    expect(audio.src).toContain("stream.local/track.mp3");
    expect(invoke).not.toHaveBeenCalledWith(
      "ios_player_load",
      expect.anything()
    );

    audio.currentTime = 42;
    expect(result.current.calculateAudioProgress()).toMatchObject({
      currentTrackId: "track-1",
      currentTimeSeconds: 42,
    });

    await act(async () => {
      await result.current.saveAudioProgress(book);
    });
    expect(invoke).toHaveBeenCalledWith("update_book_audio_state", {
      bookId: "book-1",
      audioState: expect.objectContaining({ currentTrackId: "track-1" }),
    });
  });

  it("mirrors playback into the native iOS player when on iOS", async () => {
    osType.mockReturnValue("ios");
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });

    await waitFor(() => {
      expect(osType).toHaveBeenCalled();
    });

    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const book = createBook();
    await act(async () => {
      await result.current.loadAudioTrack(book.id, book.audioTracks[0], book);
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ios_player_load",
        expect.objectContaining({
          bookId: "book-1",
          trackId: "track-1",
          title: "Intro",
        })
      );
    });

    audio.dispatchEvent(new Event("play"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ios_player_play");
    });

    audio.dispatchEvent(new Event("pause"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ios_player_pause");
    });
  });

  it("applies native-player seek and ended events to the webview audio element", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    audio.currentTime = 5;
    result.current.audioRef.current = audio;

    const ended = vi.fn();
    audio.addEventListener("ended", ended);

    await waitFor(() => {
      expect(listen.mock.calls.some((call) => call[0] === "native-player-event")).toBe(
        true
      );
    });

    act(() => {
      emitTauriEvent("native-player-event", { type: "seek", time: 40 });
    });
    expect(audio.currentTime).toBe(40);

    act(() => {
      emitTauriEvent("native-player-event", { type: "ended" });
    });
    expect(ended).toHaveBeenCalled();
  });
});
