/**
 * Browser-mode Tauri IPC mocks for Playwright (and optional local Vite).
 *
 * Enabled when Vite is started with `VITE_E2E_MOCK=1`. Real `@tauri-apps/*`
 * imports are aliased to these modules so the React app can exercise full
 * library → reader flows without a native shell.
 */

import bookWire from "../../../tests/fixtures/ipc/book.wire.json";
import chapterContentWire from "../../../tests/fixtures/ipc/chapter-content.wire.json";
import appSettingsWire from "../../../tests/fixtures/ipc/app-settings.wire.json";

type EventHandler = (event: { event: string; payload: unknown }) => void;

export type InvokeCall = { cmd: string; args?: unknown };

const listeners = new Map<string, Set<EventHandler>>();
const invokeLog: InvokeCall[] = [];

let library = [structuredClone(bookWire)];
let settings = structuredClone(appSettingsWire);
let progressSaves: unknown[] = [];
let audioStateSaves: unknown[] = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function __e2eResetState(): void {
  library = [structuredClone(bookWire)];
  settings = structuredClone(appSettingsWire);
  progressSaves = [];
  audioStateSaves = [];
  invokeLog.length = 0;
  listeners.clear();
}

export function __e2eGetInvokeLog(): InvokeCall[] {
  return [...invokeLog];
}

export function __e2eGetProgressSaves(): unknown[] {
  return [...progressSaves];
}

export function __e2eGetAudioStateSaves(): unknown[] {
  return [...audioStateSaves];
}

if (typeof window !== "undefined") {
  (
    window as unknown as {
      __AURORA_E2E__?: Record<string, unknown>;
    }
  ).__AURORA_E2E__ = {
    reset: __e2eResetState,
    getInvokeLog: __e2eGetInvokeLog,
    getProgressSaves: __e2eGetProgressSaves,
    getAudioStateSaves: __e2eGetAudioStateSaves,
  };
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: unknown
): Promise<T> {
  invokeLog.push({ cmd, args });
  const a = (args ?? {}) as Record<string, unknown>;

  switch (cmd) {
    case "read_all_books":
      return clone(library) as T;
    case "read_one_book": {
      const bookId = String(a.bookId ?? "");
      const found = library.find((b) => b.id === bookId) ?? null;
      return clone(found) as T;
    }
    case "load_chapter_content":
      return clone(chapterContentWire) as T;
    case "get_app_settings":
      return clone(settings) as T;
    case "get_reader_preferences":
      return {
        theme: settings.theme ?? "system",
        fontFamily: "merriweather",
        contentPadding: "24",
        fontSize: "16",
      } as T;
    case "update_reader_preferences":
      return undefined as T;
    case "update_app_settings": {
      settings = { ...settings, ...(a.settings as object) };
      return clone(settings) as T;
    }
    case "update_book_progress": {
      progressSaves.push(a);
      const bookId = String(a.bookId ?? "");
      const progress = a.progress;
      library = library.map((book) =>
        book.id === bookId ? { ...book, progress: progress as typeof book.progress } : book
      );
      return undefined as T;
    }
    case "update_book_audio_state": {
      audioStateSaves.push(a);
      const bookId = String(a.bookId ?? "");
      const audioState = a.audioState;
      library = library.map((book) =>
        book.id === bookId
          ? { ...book, audioState: audioState as typeof book.audioState }
          : book
      );
      return undefined as T;
    }
    case "get_audio_stream_url":
      return "http://127.0.0.1:9/e2e-mock-audio.mp3" as T;
    case "get_audio_live_stream_url":
      return "http://127.0.0.1:9/e2e-mock-live.mp3" as T;
    case "get_live_chapter_duration":
      return 0 as T;
    case "get_live_sync_marker":
      return null as T;
    case "get_current_converting_chapter":
      return null as T;
    case "get_audio_export_status":
      return { active: false } as T;
    case "delete_book": {
      const bookId = String(a.bookId ?? "");
      library = library.filter((b) => b.id !== bookId);
      return undefined as T;
    }
    case "ingest_epub":
      throw new Error("ingest_epub is not mocked in browser E2E; use WDIO Tauri mode");
    case "read_resource_file":
      return [] as T;
    default:
      console.warn(`[e2e-mock] unhandled invoke: ${cmd}`, args);
      return undefined as T;
  }
}

export async function listen(
  event: string,
  handler: EventHandler
): Promise<() => void> {
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

export async function getName(): Promise<string> {
  return "AuroraBook";
}

export async function getVersion(): Promise<string> {
  return "0.0.0-e2e";
}


export async function type(): Promise<string> {
  return "linux";
}

export async function locale(): Promise<string | null> {
  return "en-US";
}

export async function platform(): Promise<string> {
  return "linux";
}

export async function arch(): Promise<string> {
  return "x86_64";
}

export async function version(): Promise<string> {
  return "0.0.0-e2e";
}

export async function open(): Promise<string | null> {
  return null;
}

export async function save(): Promise<string | null> {
  return null;
}

export async function message(): Promise<void> {}
export async function ask(): Promise<boolean> {
  return false;
}
export async function confirm(): Promise<boolean> {
  return false;
}

export const BaseDirectory = {};

export async function readFile(): Promise<Uint8Array> {
  return new Uint8Array();
}
export async function writeFile(): Promise<void> {}
export async function exists(): Promise<boolean> {
  return false;
}
export async function mkdir(): Promise<void> {}
export async function readDir(): Promise<unknown[]> {
  return [];
}
export async function remove(): Promise<void> {}
export async function copyFile(): Promise<void> {}

export const Store = {
  load: async () => ({
    get: async () => undefined,
    set: async () => {},
    save: async () => {},
    delete: async () => {},
  }),
};

export async function load() {
  return Store.load();
}

export async function openUrl(): Promise<void> {}
export async function openPath(): Promise<void> {}
