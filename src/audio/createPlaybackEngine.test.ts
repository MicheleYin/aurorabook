import { beforeEach, describe, expect, it } from "vitest";

import { createPlaybackEngine } from "./createPlaybackEngine";
import { osType } from "../test/tauri-mocks";

describe("createPlaybackEngine", () => {
  beforeEach(() => {
    osType.mockReset();
  });

  it("returns ios-native engine on iOS", async () => {
    osType.mockReturnValue("ios");
    const engine = await createPlaybackEngine(() => null);
    expect(engine.kind).toBe("ios-native");
    engine.destroy();
  });

  it("returns android engine on Android", async () => {
    osType.mockReturnValue("android");
    const engine = await createPlaybackEngine(() => document.createElement("audio"));
    expect(engine.kind).toBe("android");
    engine.destroy();
  });

  it("returns webview engine on macOS", async () => {
    osType.mockReturnValue("macos");
    const engine = await createPlaybackEngine(() => document.createElement("audio"));
    expect(engine.kind).toBe("webview");
    engine.destroy();
  });
});
