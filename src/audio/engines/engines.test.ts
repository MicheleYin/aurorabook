import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAndroidEngine } from "./androidEngine";
import { createIosNativeEngine } from "./iosNativeEngine";
import { createWebviewEngine } from "./webviewEngine";

const invoke = vi.fn();
const listen = vi.fn(async (..._args: unknown[]) => () => undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) =>
    args === undefined ? invoke(cmd) : invoke(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, handler: (event: unknown) => void) =>
    listen(eventName, handler),
}));

describe("createWebviewEngine", () => {
  beforeEach(() => {
    invoke.mockReset();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        playbackState: "none",
        metadata: null,
        setActionHandler: vi.fn(),
        setPositionState: vi.fn(),
      },
    });
  });

  it("loads a stream URL into the audio element and plays", async () => {
    const audio = document.createElement("audio");
    audio.play = vi.fn(async () => undefined);
    const engine = createWebviewEngine(() => audio);

    await engine.load({
      bookId: "b1",
      trackId: "t1",
      title: "Track",
      artist: "Author",
      duration: 10,
      streamUrl: "http://127.0.0.1:9/audio",
      playbackRate: 1.25,
    });

    expect(audio.src).toContain("http://127.0.0.1:9/audio");
    expect(audio.playbackRate).toBe(1.25);

    await engine.play();
    expect(audio.play).toHaveBeenCalled();
    expect(engine.isPlaying()).toBe(false); // paused until real play event

    engine.destroy();
  });

  it("binds Media Session play/pause handlers to the audio element", async () => {
    const audio = document.createElement("audio");
    audio.play = vi.fn(async () => undefined);
    audio.pause = vi.fn();
    const setActionHandler = vi.fn();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        playbackState: "none",
        metadata: null,
        setActionHandler,
        setPositionState: vi.fn(),
      },
    });

    const engine = createWebviewEngine(() => audio);
    await engine.load({
      bookId: "b1",
      trackId: "t1",
      title: "Track",
      artist: "Author",
      duration: 10,
      streamUrl: "http://127.0.0.1:9/audio",
    });

    expect(setActionHandler).toHaveBeenCalledWith("play", expect.any(Function));
    expect(setActionHandler).toHaveBeenCalledWith(
      "pause",
      expect.any(Function)
    );

    const playHandler = [...setActionHandler.mock.calls]
      .reverse()
      .find(
        (call) => call[0] === "play" && typeof call[1] === "function"
      )?.[1] as ((details: MediaSessionActionDetails) => void) | undefined;
    playHandler?.({ action: "play" });
    await vi.waitFor(() => {
      expect(audio.play).toHaveBeenCalled();
    });

    engine.destroy();
  });
});

describe("createIosNativeEngine", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockClear();
    invoke.mockResolvedValue(undefined);
  });

  it("loads and controls via ios_player_* commands", async () => {
    const engine = createIosNativeEngine();
    await engine.load({
      bookId: "b1",
      trackId: "t1",
      title: "Intro",
      artist: "Author",
      duration: 120,
      coverUrl: null,
      playbackRate: 1.5,
    });

    expect(invoke).toHaveBeenCalledWith(
      "ios_player_load",
      expect.objectContaining({
        options: expect.objectContaining({
          bookId: "b1",
          trackId: "t1",
          title: "Intro",
        }),
      })
    );
    expect(invoke).toHaveBeenCalledWith("ios_player_set_rate", { rate: 1.5 });

    await engine.play();
    expect(invoke).toHaveBeenCalledWith("ios_player_play");
    expect(engine.isPlaying()).toBe(true);
    await engine.pause();
    expect(invoke).toHaveBeenCalledWith("ios_player_pause");
    expect(engine.isPlaying()).toBe(false);
    await engine.seek(33);
    expect(invoke).toHaveBeenCalledWith("ios_player_seek", { seconds: 33 });
    expect(engine.getCurrentTime()).toBe(33);

    engine.destroy();
  });

  it("emits seek so paused UI can update the progress bar", async () => {
    invoke.mockResolvedValue(undefined);
    const engine = createIosNativeEngine();
    const onEvent = vi.fn();
    engine.subscribe(onEvent);

    await engine.seek(42);
    expect(onEvent).toHaveBeenCalledWith({ type: "seek", time: 42 });

    engine.destroy();
  });

  it("scopes live refresh and completion updates to the latest load", async () => {
    invoke.mockResolvedValue({ durationSeconds: 4, byteLength: 64 });
    const engine = createIosNativeEngine();

    await engine.loadLive({
      bookId: "book-a",
      chapterIndex: 1,
      expectsMore: true,
      title: "Chapter",
      artist: "Author",
    });
    const firstLoad = invoke.mock.calls.find(
      ([command]) => command === "ios_player_load_live"
    )?.[1] as { options: { requestId: number } };

    await engine.loadLive({
      bookId: "book-b",
      chapterIndex: 2,
      expectsMore: false,
      title: "Chapter",
      artist: "Author",
    });
    const latestLoad = invoke.mock.calls
      .filter(([command]) => command === "ios_player_load_live")
      .at(-1)?.[1] as {
      options: { requestId: number; expectsMore: boolean };
    };

    await engine.refreshLive("book-b", 2);
    await engine.setExpectsMore(false, "book-b", 2);

    expect(latestLoad.options.requestId).toBeGreaterThan(
      firstLoad.options.requestId
    );
    expect(latestLoad.options.expectsMore).toBe(false);
    expect(invoke).toHaveBeenCalledWith(
      "ios_player_refresh_live",
      expect.objectContaining({ requestId: latestLoad.options.requestId })
    );
    expect(invoke).toHaveBeenCalledWith(
      "ios_player_set_expects_more",
      expect.objectContaining({
        bookId: "book-b",
        chapterIndex: 2,
        requestId: latestLoad.options.requestId,
      })
    );

    engine.destroy();
  });

  it("does not infer playback from a time update", () => {
    const engine = createIosNativeEngine();
    engine.subscribe(vi.fn());
    const onNativeEvent = listen.mock.calls[0][1] as (
      event: { payload: { type: string; time: number } }
    ) => void;

    onNativeEvent({ payload: { type: "timeUpdate", time: 12 } });

    expect(engine.getCurrentTime()).toBe(12);
    expect(engine.isPlaying()).toBe(false);
    engine.destroy();
  });
});

describe("createAndroidEngine", () => {
  it("reports android kind while using webview behavior", async () => {
    const audio = document.createElement("audio");
    const engine = createAndroidEngine(() => audio);
    expect(engine.kind).toBe("android");
    engine.destroy();
  });
});
