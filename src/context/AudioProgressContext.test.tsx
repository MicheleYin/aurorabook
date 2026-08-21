import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import {
  AudioProgressProvider,
  useAudioProgressContext,
} from "./AudioProgressContext";
import { ConversionStateProvider } from "./ConversionStateContext";
import type { AudioTrack, Book } from "../types/book";
import {
  emitTauriEvent,
  getName,
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
    conversionStatus: "done",
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
      value: vi.fn(function (this: HTMLAudioElement) {
        queueMicrotask(() => {
          this.dispatchEvent(new Event("loadedmetadata"));
          this.dispatchEvent(new Event("canplay"));
        });
      }),
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
  return (
    <ConversionStateProvider>
      <AudioProgressProvider>{children}</AudioProgressProvider>
    </ConversionStateProvider>
  );
}

describe("AudioProgressProvider", () => {
  beforeEach(() => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { audioPlaybackSpeed: 1.25 };
      }
      if (cmd === "get_current_converting_chapter") {
        return null;
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
    expect(result.current.calculateAudioProgress()).toEqual({
      currentTrackId: "track-1",
      currentTrackHref: "audio/01.mp3",
      currentTrackIndex: 0,
      currentTimeSeconds: 42,
      updatedAt: expect.any(String),
    });

    await act(async () => {
      await result.current.saveAudioProgress(book);
    });
    expect(invoke).toHaveBeenCalledWith("update_book_audio_state", {
      bookId: "book-1",
      audioState: {
        currentTrackId: "track-1",
        currentTrackHref: "audio/01.mp3",
        currentTrackIndex: 0,
        currentTimeSeconds: 42,
        updatedAt: expect.any(String),
      },
    });
  });

  it("does not save audio progress when no track is loaded", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    invoke.mockClear();

    await act(async () => {
      await result.current.saveAudioProgress(createBook());
    });

    expect(invoke).not.toHaveBeenCalledWith(
      "update_book_audio_state",
      expect.anything()
    );
  });

  it("defaults currentTimeSeconds to 0 when the audio element has no time", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const book = createBook();
    await act(async () => {
      await result.current.loadAudioTrack(book.id, book.audioTracks[0], book);
    });

    // Leave currentTime at default 0 and ensure wire payload is complete.
    await act(async () => {
      await result.current.saveAudioProgress(book);
    });

    expect(invoke).toHaveBeenCalledWith("update_book_audio_state", {
      bookId: "book-1",
      audioState: expect.objectContaining({
        currentTrackId: "track-1",
        currentTrackHref: "audio/01.mp3",
        currentTrackIndex: 0,
        currentTimeSeconds: 0,
        updatedAt: expect.any(String),
      }),
    });
  });

  it("swallows save errors without throwing", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const book = createBook();
    await act(async () => {
      await result.current.loadAudioTrack(book.id, book.audioTracks[0], book);
    });

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "update_book_audio_state") {
        throw new Error("db locked");
      }
      if (cmd === "get_app_settings") return { audioPlaybackSpeed: 1 };
      if (cmd === "get_current_converting_chapter") return null;
      if (cmd === "get_audio_stream_url") return "https://stream.local/track.mp3";
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    await expect(
      act(async () => {
        await result.current.saveAudioProgress(book);
      })
    ).resolves.toBeUndefined();
  });

  it("restores saved track time matched by track id", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const track = createTrack();
    const book = createBook({
      audioState: {
        currentTrackId: track.id,
        currentTrackHref: track.href ?? track.filePath ?? "",
        currentTrackIndex: track.order,
        currentTimeSeconds: 33,
        updatedAt: new Date().toISOString(),
      },
    });

    act(() => {
      result.current.restoreAudioProgress(book, track, true);
    });

    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(33);
    expect(audio.play).toHaveBeenCalled();
  });

  it("restores saved track time matched by href when ids differ", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    Object.defineProperty(audio, "readyState", {
      configurable: true,
      get: () => 2,
    });
    result.current.audioRef.current = audio;

    const track = createTrack({ id: "track-new" });
    const book = createBook({
      audioState: {
        currentTrackId: "track-old",
        currentTrackHref: "audio/01.mp3",
        currentTrackIndex: 99,
        currentTimeSeconds: 17,
        updatedAt: new Date().toISOString(),
      },
    });

    act(() => {
      result.current.restoreAudioProgress(book, track, false);
    });

    expect(audio.currentTime).toBe(17);
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("restores saved track time matched by chapter index", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    Object.defineProperty(audio, "readyState", {
      configurable: true,
      get: () => 2,
    });
    result.current.audioRef.current = audio;

    const track = createTrack({
      id: "track-live",
      href: "Text/ch1.xhtml",
      filePath: "Text/ch1.xhtml",
      order: 0,
    });
    const book = createBook({
      audioState: {
        currentTrackId: "other-id",
        currentTrackHref: "Audio/other.mp3",
        currentTrackIndex: 0,
        currentTimeSeconds: 9.5,
        updatedAt: new Date().toISOString(),
      },
    });

    act(() => {
      result.current.restoreAudioProgress(book, track, false);
    });

    expect(audio.currentTime).toBe(9.5);
  });

  it("does not seek when saved audio state is for a different track", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    audio.currentTime = 3;
    Object.defineProperty(audio, "readyState", {
      configurable: true,
      get: () => 2,
    });
    result.current.audioRef.current = audio;

    const track = createTrack({ id: "track-1", order: 0, href: "a.mp3" });
    const book = createBook({
      audioState: {
        currentTrackId: "track-2",
        currentTrackHref: "b.mp3",
        currentTrackIndex: 1,
        currentTimeSeconds: 55,
        updatedAt: new Date().toISOString(),
      },
    });

    act(() => {
      result.current.restoreAudioProgress(book, track, false);
    });

    expect(audio.currentTime).toBe(3);
  });

  it("round-trips audio save then restore for the same track", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const book = createBook();
    const track = book.audioTracks[0];

    await act(async () => {
      await result.current.loadAudioTrack(book.id, track, book);
    });

    audio.currentTime = 28;
    await act(async () => {
      await result.current.saveAudioProgress(book);
    });

    const saveCall = invoke.mock.calls.find(
      (call) => call[0] === "update_book_audio_state"
    );
    const audioState = (
      saveCall?.[1] as {
        audioState: {
          currentTrackId: string;
          currentTrackHref: string;
          currentTrackIndex: number;
          currentTimeSeconds: number;
          updatedAt: string;
        };
      }
    ).audioState;

    expect(audioState).toEqual({
      currentTrackId: "track-1",
      currentTrackHref: "audio/01.mp3",
      currentTrackIndex: 0,
      currentTimeSeconds: 28,
      updatedAt: expect.any(String),
    });

    const restoreAudio = createAudioElement();
    Object.defineProperty(restoreAudio, "readyState", {
      configurable: true,
      get: () => 2,
    });
    result.current.audioRef.current = restoreAudio;

    act(() => {
      result.current.restoreAudioProgress(
        { ...book, audioState },
        track,
        false
      );
    });

    expect(restoreAudio.currentTime).toBe(28);
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

  it("updates playback rate on the audio element and persists settings", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return { audioPlaybackSpeed: 1 };
      }
      if (cmd === "update_app_settings") {
        return { audioPlaybackSpeed: 1.5 };
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    await waitFor(() => {
      expect(result.current.playbackRate).toBe(1);
    });

    await act(async () => {
      result.current.setPlaybackRate(1.5);
    });

    expect(result.current.playbackRate).toBe(1.5);
    expect(audio.playbackRate).toBe(1.5);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "update_app_settings",
        expect.objectContaining({
          settings: expect.objectContaining({ audioPlaybackSpeed: 1.5 }),
        })
      );
    });
  });

  it("loads the last opened track from the backend book state", async () => {
    const track = createTrack({ id: "track-2", order: 1, title: "Next" });
    const book = createBook({
      audioTracks: [createTrack(), track],
      audioState: {
        currentTrackId: "track-2",
        currentTrackHref: track.href ?? track.filePath ?? "ch1.xhtml",
        currentTrackIndex: 1,
        currentTimeSeconds: 10,
        updatedAt: new Date().toISOString(),
      },
    });

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") return { audioPlaybackSpeed: 1 };
      if (cmd === "read_one_book") return book;
      if (cmd === "get_audio_stream_url") {
        return "https://stream.local/track-2.mp3";
      }
      if (cmd === "update_book_audio_state") return undefined;
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    await act(async () => {
      await result.current.loadLastOpenedAudioTrack(book, false);
    });

    expect(result.current.currentAudioTrack?.id).toBe("track-2");
    expect(audio.src).toContain("track-2.mp3");
  });

  it("clears playback when the book has no audio tracks", async () => {
    const book = createBook({ audioTracks: [], audioState: undefined });
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") return { audioPlaybackSpeed: 1 };
      if (cmd === "read_one_book") return book;
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;
    result.current.blobUrlRef.current = "blob:old";

    await act(async () => {
      await result.current.loadLastOpenedAudioTrack(book, false);
    });

    expect(result.current.currentAudioTrack).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
  });

  it("saves progress and clears state when closing the player", async () => {
    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const book = createBook({
      audioState: {
        currentTrackId: "track-1",
        currentTrackHref: "ch1.xhtml",
        currentTrackIndex: 0,
        currentTimeSeconds: 5,
        updatedAt: new Date().toISOString(),
      },
    });

    await act(async () => {
      await result.current.loadAudioTrack(book.id, book.audioTracks[0], book);
    });

    audio.currentTime = 55;
    await act(async () => {
      await result.current.closeAudioPlayer(book);
    });

    expect(invoke).toHaveBeenCalledWith(
      "update_book_audio_state",
      expect.objectContaining({ bookId: "book-1" })
    );
    expect(result.current.currentAudioTrack).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
  });

  it("reconnects the stream URL after audio-server-restarted", async () => {
    let paused = false;
    const audio = createAudioElement();
    Object.defineProperty(audio, "paused", {
      configurable: true,
      get: () => paused,
    });

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") return { audioPlaybackSpeed: 1 };
      if (cmd === "get_audio_stream_url") {
        return "https://stream.local/reconnect.mp3";
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    result.current.audioRef.current = audio;

    await act(async () => {
      await result.current.loadAudioTrack(
        "book-1",
        createTrack(),
        createBook()
      );
    });

    audio.currentTime = 17;
    paused = false;

    await waitFor(() => {
      expect(
        listen.mock.calls.some((c) => c[0] === "audio-server-restarted")
      ).toBe(true);
    });

    await act(async () => {
      emitTauriEvent("audio-server-restarted", 9);
    });

    await waitFor(() => {
      expect(audio.src).toContain("reconnect.mp3");
    });

    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(17);
    expect(audio.play).toHaveBeenCalled();
  });

  it("sets MediaSession metadata with cover artwork and chapter title", async () => {
    class FakeMediaMetadata {
      title?: string;
      artist?: string;
      album?: string;
      artwork?: MediaImage[];
      constructor(init?: MediaMetadataInit) {
        Object.assign(this, init);
      }
    }
    Object.defineProperty(window, "MediaMetadata", {
      configurable: true,
      writable: true,
      value: FakeMediaMetadata,
    });
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      writable: true,
      value: { metadata: null },
    });

    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const book = createBook({
      coverUrl: "https://cdn.example/cover.jpg",
      author: "Ada",
    });

    await act(async () => {
      await result.current.loadAudioTrack(book.id, book.audioTracks[0], book);
    });

    await waitFor(() => {
      expect(navigator.mediaSession.metadata).toMatchObject({
        title: "Intro - Chapter 1",
        artist: "Ada",
        album: "Test Book - AuroraBook",
        artwork: [
          expect.objectContaining({
            src: "https://cdn.example/cover.jpg",
            sizes: "512x512",
          }),
        ],
      });
    });
  });

  it("falls back to album-only MediaSession metadata when getName fails", async () => {
    class FakeMediaMetadata {
      title?: string;
      artist?: string;
      album?: string;
      artwork?: MediaImage[];
      constructor(init?: MediaMetadataInit) {
        Object.assign(this, init);
      }
    }
    Object.defineProperty(window, "MediaMetadata", {
      configurable: true,
      writable: true,
      value: FakeMediaMetadata,
    });
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      writable: true,
      value: { metadata: null },
    });
    getName.mockRejectedValueOnce(new Error("no app name"));

    const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
    const audio = createAudioElement();
    result.current.audioRef.current = audio;

    const book = createBook({ coverUrl: undefined, author: "Ada" });

    await act(async () => {
      await result.current.loadAudioTrack(book.id, book.audioTracks[0], book);
    });

    await waitFor(() => {
      expect(navigator.mediaSession.metadata).toMatchObject({
        title: "Intro - Chapter 1",
        artist: "Ada",
        album: "Test Book",
        artwork: [],
      });
    });
  });

  describe("live chapter playback", () => {
    it("does not mark a completed library track as live when converting chapter matches", async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { audioPlaybackSpeed: 1.25 };
        }
        if (cmd === "get_current_converting_chapter") {
          // Stale/racing pointer still on this chapter index.
          return 0;
        }
        if (cmd === "get_audio_stream_url") {
          return "https://stream.local/track.mp3";
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
      const audio = createAudioElement();
      result.current.audioRef.current = audio;

      const book = createBook();

      await act(async () => {
        await result.current.loadAudioTrack(book.id, book.audioTracks[0], book);
      });

      expect(result.current.currentAudioTrack).toMatchObject({
        id: "track-1",
        isLiveStream: false,
      });
      expect(invoke).toHaveBeenCalledWith("get_audio_stream_url", {
        bookId: "book-1",
        trackId: "track-1",
      });
      expect(audio.src).toContain("https://stream.local/track.mp3");
    });

    it("marks a missing-chapter track as live when converting chapter matches", async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { audioPlaybackSpeed: 1.25 };
        }
        if (cmd === "get_current_converting_chapter") {
          return 0;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
      const audio = createAudioElement();
      result.current.audioRef.current = audio;

      const book = createBook({ audioTracks: [] });
      const inProgressTrack = createTrack({
        id: "pending-ch-0",
        chapterHref: "ch1.xhtml",
        href: "ch1.xhtml",
        filePath: "ch1.xhtml",
        title: "Chapter 1",
        order: 0,
      });

      await act(async () => {
        await result.current.loadAudioTrack(book.id, inProgressTrack, book);
      });

      expect(result.current.currentAudioTrack).toMatchObject({
        id: "pending-ch-0",
        isLiveStream: true,
        liveChapterIndex: 0,
        mimeType: "audio/mpeg",
      });
      expect(invoke).not.toHaveBeenCalledWith(
        "get_audio_stream_url",
        expect.anything()
      );
      expect(audio.src).toBe("");
    });

    it("treats explicit live-* track ids as live streams", async () => {
      const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
      const book = createBook({
        chapters: [
          {
            id: "ch-1",
            bookId: "book-1",
            title: "Chapter 1",
            href: "ch1.xhtml",
            chapterOrder: 0,
          },
          {
            id: "ch-2",
            bookId: "book-1",
            title: "Chapter 2",
            href: "ch2.xhtml",
            chapterOrder: 1,
          },
        ],
      });
      const liveTrack = createTrack({
        id: "live-book-1-1",
        chapterHref: "ch2.xhtml",
        href: "ch2.xhtml",
        filePath: "ch2.xhtml",
        title: "Chapter 2",
        order: 1,
      });

      await act(async () => {
        await result.current.loadAudioTrack(book.id, liveTrack, book);
      });

      expect(result.current.currentAudioTrack).toMatchObject({
        id: "live-book-1-1",
        isLiveStream: true,
        liveChapterIndex: 1,
      });
      expect(invoke).not.toHaveBeenCalledWith(
        "get_audio_stream_url",
        expect.anything()
      );
    });

    it("falls back to live playback when stream URL fails for an in-progress chapter", async () => {
      let convertingChapterCalls = 0;
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { audioPlaybackSpeed: 1 };
        }
        if (cmd === "get_current_converting_chapter") {
          convertingChapterCalls += 1;
          // First refresh during load returns null; retry after stream failure is live.
          return convertingChapterCalls === 1 ? null : 0;
        }
        if (cmd === "get_audio_stream_url") {
          throw new Error("track not ready");
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      const { result } = renderHook(() => useAudioProgressContext(), { wrapper });
      // Track is not yet in book.audioTracks — still converting.
      const book = createBook({ audioTracks: [] });
      const pendingTrack = createTrack({
        id: "pending-ch-0",
        chapterHref: "ch1.xhtml",
        href: "ch1.xhtml",
        filePath: "ch1.xhtml",
        title: "Chapter 1",
        order: 0,
      });

      await act(async () => {
        await result.current.loadAudioTrack(book.id, pendingTrack, book);
      });

      expect(result.current.currentAudioTrack).toMatchObject({
        id: "pending-ch-0",
        isLiveStream: true,
        liveChapterIndex: 0,
      });
      expect(convertingChapterCalls).toBeGreaterThanOrEqual(2);
    });

    it("loads a synthetic live track when restoring the last opened converting chapter", async () => {
      const book = createBook({
        chapters: [
          {
            id: "ch-1",
            bookId: "book-1",
            title: "Live Chapter",
            href: "ch1.xhtml",
            chapterOrder: 0,
          },
        ],
        audioTracks: [],
      });

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { audioPlaybackSpeed: 1 };
        }
        if (cmd === "get_current_converting_chapter") {
          return 0;
        }
        if (cmd === "read_one_book") {
          return book;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      const { result } = renderHook(() => useAudioProgressContext(), { wrapper });

      await act(async () => {
        await result.current.loadLastOpenedAudioTrack(book, false);
      });

      expect(result.current.currentAudioTrack).toMatchObject({
        id: "live-book-1-0",
        isLiveStream: true,
        liveChapterIndex: 0,
        title: "Live Chapter",
      });
    });

    it("loads incomplete chapter audio after pause when conversion is started", async () => {
      const book = createBook({
        conversionStatus: "started",
        completedChapters: [],
        chapters: [
          {
            id: "ch-1",
            bookId: "book-1",
            title: "Incomplete Chapter",
            href: "ch1.xhtml",
            chapterOrder: 0,
          },
          {
            id: "ch-2",
            bookId: "book-1",
            title: "Next Chapter",
            href: "ch2.xhtml",
            chapterOrder: 1,
          },
        ],
        audioTracks: [],
      });

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { audioPlaybackSpeed: 1 };
        }
        if (cmd === "get_current_converting_chapter") {
          // Simulates paused checkpoint discovery from backend.
          return 0;
        }
        if (cmd === "read_one_book") {
          return book;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      const { result } = renderHook(() => useAudioProgressContext(), { wrapper });

      await act(async () => {
        await result.current.loadLastOpenedAudioTrack(book, false);
      });

      expect(result.current.currentAudioTrack).toMatchObject({
        id: "live-book-1-0",
        isLiveStream: true,
        liveChapterIndex: 0,
        title: "Incomplete Chapter",
      });
    });

    it("falls back to first incomplete chapter when converting chapter is unknown", async () => {
      const book = createBook({
        conversionStatus: "started",
        completedChapters: ["ch1.xhtml"],
        chapters: [
          {
            id: "ch-1",
            bookId: "book-1",
            title: "Done",
            href: "ch1.xhtml",
            chapterOrder: 0,
          },
          {
            id: "ch-2",
            bookId: "book-1",
            title: "In Progress",
            href: "ch2.xhtml",
            chapterOrder: 1,
          },
        ],
        audioTracks: [
          {
            id: "track-1",
            bookId: "book-1",
            chapterHref: "ch1.xhtml",
            title: "Done",
            href: "ch1.xhtml",
            filePath: "ch1.xhtml",
            order: 0,
          },
        ],
      });

      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_app_settings") {
          return { audioPlaybackSpeed: 1 };
        }
        if (cmd === "get_current_converting_chapter") {
          return null;
        }
        if (cmd === "read_one_book") {
          return book;
        }
        throw new Error(`Unexpected invoke: ${cmd}`);
      });

      const { result } = renderHook(() => useAudioProgressContext(), { wrapper });

      await act(async () => {
        await result.current.loadLastOpenedAudioTrack(book, false);
      });

      expect(result.current.currentAudioTrack).toMatchObject({
        id: "live-book-1-1",
        isLiveStream: true,
        liveChapterIndex: 1,
        title: "In Progress",
      });
    });

    it("queues live playback seek/autoplay requests", async () => {
      const { result } = renderHook(() => useAudioProgressContext(), { wrapper });

      const versionBefore = result.current.livePlaybackRequestVersion;

      act(() => {
        result.current.queueLivePlaybackRequest(12.5, true);
      });

      expect(result.current.livePlaybackRequestRef.current).toEqual({
        resumeTime: 12.5,
        autoPlay: true,
      });
      expect(result.current.livePlaybackRequestVersion).toBe(versionBefore + 1);
    });
  });
});
