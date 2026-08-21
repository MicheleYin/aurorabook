/**
 * Browser-mode Tauri IPC mocks for Playwright (and optional local Vite).
 *
 * Enabled when Vite is started with `VITE_E2E_MOCK=1`. Real `@tauri-apps/*`
 * imports are aliased to these modules so the React app can exercise full
 * library → reader flows without a native shell.
 */

import bookWire from "../../../tests/fixtures/ipc/book.wire.json";
import bookBWire from "../../../tests/fixtures/ipc/book-b.wire.json";
import chapterContentWire from "../../../tests/fixtures/ipc/chapter-content.wire.json";
import chapterContent2Wire from "../../../tests/fixtures/ipc/chapter-content-2.wire.json";
import chapterContentBWire from "../../../tests/fixtures/ipc/chapter-content-b.wire.json";
import appSettingsWire from "../../../tests/fixtures/ipc/app-settings.wire.json";

type EventHandler = (event: { event: string; payload: unknown }) => void;

export type InvokeCall = { cmd: string; args?: unknown };

type BookWire = typeof bookWire;

const listeners = new Map<string, Set<EventHandler>>();
const invokeLog: InvokeCall[] = [];

let library: BookWire[] = [structuredClone(bookWire)];
let settings = structuredClone(appSettingsWire);
let progressSaves: unknown[] = [];
let audioStateSaves: unknown[] = [];
let libraryDelayMs = 0;
let chapterDelayMs = 0;
let audioDelayMs = 0;
let convertHangMs = 0;
let silentAudioUrl: string | null = null;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ~60s of silence so seeks (e.g. restore to 12s) succeed in Chromium. */
function ensureSilentAudioUrl(): string {
  if (silentAudioUrl) {
    return silentAudioUrl;
  }
  if (typeof document === "undefined") {
    return "http://127.0.0.1:9/e2e-mock-audio.mp3";
  }

  const sampleRate = 8000;
  const seconds = 60;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const blob = new Blob([buffer], { type: "audio/wav" });
  silentAudioUrl = URL.createObjectURL(blob);
  return silentAudioUrl;
}

function chapterForHref(href: string) {
  if (href.includes("chap2")) {
    return chapterContent2Wire;
  }
  if (href.includes("b-chap1") || href.includes("Text/b-")) {
    return chapterContentBWire;
  }
  return chapterContentWire;
}

export function __e2eResetState(): void {
  library = [structuredClone(bookWire)];
  settings = structuredClone(appSettingsWire);
  progressSaves = [];
  audioStateSaves = [];
  invokeLog.length = 0;
  listeners.clear();
  libraryDelayMs = 0;
  chapterDelayMs = 0;
  audioDelayMs = 0;
  convertHangMs = 0;
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

export function __e2eGetLibrary(): BookWire[] {
  return clone(library);
}

export function __e2eSetLibrary(books: BookWire[]): void {
  library = books.map((book) => structuredClone(book));
}

export function __e2eSeedTwoBooks(): void {
  library = [structuredClone(bookWire), structuredClone(bookBWire)];
}

export function __e2eSetDelays(options: {
  libraryMs?: number;
  chapterMs?: number;
  audioMs?: number;
  convertHangMs?: number;
}): void {
  if (options.libraryMs !== undefined) libraryDelayMs = options.libraryMs;
  if (options.chapterMs !== undefined) chapterDelayMs = options.chapterMs;
  if (options.audioMs !== undefined) audioDelayMs = options.audioMs;
  if (options.convertHangMs !== undefined) {
    convertHangMs = options.convertHangMs;
  }
}

export function __e2eEmit(event: string, payload: unknown): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of set) {
    handler({ event, payload });
  }
}

export function __e2ePatchBook(
  bookId: string,
  patch: Partial<BookWire>
): BookWire | null {
  let updated: BookWire | null = null;
  library = library.map((book) => {
    if (book.id !== bookId) return book;
    updated = { ...book, ...patch };
    return updated;
  });
  return updated ? clone(updated) : null;
}

if (typeof window !== "undefined") {
  const boot = (
    window as unknown as {
      __AURORA_E2E_BOOT__?: {
        seedTwoBooks?: boolean;
        libraryMs?: number;
        chapterMs?: number;
        audioMs?: number;
        convertHangMs?: number;
        patchFirstBook?: Partial<BookWire>;
      };
    }
  ).__AURORA_E2E_BOOT__;

  if (boot) {
    if (boot.seedTwoBooks) {
      library = [structuredClone(bookWire), structuredClone(bookBWire)];
    }
    if (boot.patchFirstBook && library[0]) {
      library[0] = { ...library[0], ...structuredClone(boot.patchFirstBook) };
    }
    if (boot.libraryMs !== undefined) libraryDelayMs = boot.libraryMs;
    if (boot.chapterMs !== undefined) chapterDelayMs = boot.chapterMs;
    if (boot.audioMs !== undefined) audioDelayMs = boot.audioMs;
    if (boot.convertHangMs !== undefined) convertHangMs = boot.convertHangMs;
  }

  (
    window as unknown as {
      __AURORA_E2E__?: Record<string, unknown>;
    }
  ).__AURORA_E2E__ = {
    reset: __e2eResetState,
    getInvokeLog: __e2eGetInvokeLog,
    getProgressSaves: __e2eGetProgressSaves,
    getAudioStateSaves: __e2eGetAudioStateSaves,
    getLibrary: __e2eGetLibrary,
    setLibrary: __e2eSetLibrary,
    seedTwoBooks: __e2eSeedTwoBooks,
    setDelays: __e2eSetDelays,
    emit: __e2eEmit,
    patchBook: __e2ePatchBook,
    fixtures: {
      bookA: structuredClone(bookWire),
      bookB: structuredClone(bookBWire),
    },
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
      if (libraryDelayMs > 0) await sleep(libraryDelayMs);
      return clone(library) as T;
    case "read_one_book": {
      const bookId = String(a.bookId ?? "");
      const found = library.find((b) => b.id === bookId) ?? null;
      return clone(found) as T;
    }
    case "load_chapter_content": {
      if (chapterDelayMs > 0) await sleep(chapterDelayMs);
      const href = String(a.chapterHref ?? "");
      return clone(chapterForHref(href)) as T;
    }
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
        book.id === bookId
          ? { ...book, progress: progress as typeof book.progress }
          : book
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
      if (audioDelayMs > 0) await sleep(audioDelayMs);
      return ensureSilentAudioUrl() as T;
    case "get_audio_live_stream_url":
      if (audioDelayMs > 0) await sleep(audioDelayMs);
      return ensureSilentAudioUrl() as T;
    case "get_live_chapter_duration":
      return 0 as T;
    case "get_live_sync_marker":
      return null as T;
    case "get_current_converting_chapter":
      return null as T;
    case "get_audio_export_status":
      return { active: false } as T;
    case "convert_epub_to_audiobook_command": {
      const bookId = String(a.bookId ?? "");
      if (convertHangMs > 0) {
        await sleep(convertHangMs);
      }
      const found = library.find((b) => b.id === bookId) ?? null;
      return clone(found) as T;
    }
    case "cancel_conversion":
      return undefined as T;
    case "delete_book": {
      const bookId = String(a.bookId ?? "");
      library = library.filter((b) => b.id !== bookId);
      return undefined as T;
    }
    case "ingest_epub":
      throw new Error(
        "ingest_epub is not mocked in browser E2E; use WDIO Tauri mode"
      );
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
  return true;
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
