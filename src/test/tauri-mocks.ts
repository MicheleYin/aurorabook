import { vi } from "vitest";

type EventHandler = (event: { event: string; payload: unknown }) => void;
type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

const listeners = new Map<string, Set<EventHandler>>();

export const invoke = vi.fn<InvokeFn>(async () => {
  throw new Error("Tauri invoke is not available in unit tests");
});

export const listen = vi.fn(
  async (event: string, handler: EventHandler): Promise<() => void> => {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }
);

export const osType = vi.fn((): string => "macos");
export const locale = vi.fn(async () => "en-US");
export const getName = vi.fn(async () => "AuroraBook");

/** Emit a Tauri-style event to all registered listeners. */
export function emitTauriEvent(event: string, payload: unknown): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of set) {
    handler({ event, payload });
  }
}

export function clearTauriListeners(): void {
  listeners.clear();
}

export function resetTauriMocks(): void {
  invoke.mockReset();
  invoke.mockImplementation(async () => {
    throw new Error("Tauri invoke is not available in unit tests");
  });
  listen.mockClear();
  osType.mockReset();
  osType.mockReturnValue("macos");
  locale.mockReset();
  locale.mockResolvedValue("en-US");
  getName.mockReset();
  getName.mockResolvedValue("AuroraBook");
  clearTauriListeners();
}
