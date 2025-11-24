import { isTauriEnvironment } from "./is-tauri";

const STORE_PATH = "kokoro-assets.store.json";
const STORE_KEY = "kokoroAssets";
const KOKORO_MODEL_BASE = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";

type StoreHandle = {
  set: (key: string, value: unknown) => Promise<void>;
  get: <T>(key: string) => Promise<T | null | undefined>;
  save: () => Promise<void>;
};

type SerializedHeaders = Array<[string, string]>;

type CachedAsset = {
  data: string;
  status: number;
  statusText?: string;
  headers: SerializedHeaders;
  timestamp: number;
};

type AssetDictionary = Record<string, CachedAsset>;

let storeRef: StoreHandle | null = null;
let fetchPatched = false;
let assetCache: AssetDictionary | null = null;

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToArrayBuffer = (value: string) => {
  const binary = atob(value);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const serializeHeaders = (headers: Headers): SerializedHeaders => [...headers.entries()];

const deserializeHeaders = (headers: SerializedHeaders) => new Headers(headers);

const shouldHandleUrl = (url?: string) =>
  typeof url === "string" && url.startsWith(KOKORO_MODEL_BASE);

const getStore = async (): Promise<StoreHandle | null> => {
  if (!isTauriEnvironment()) return null;
  if (storeRef) return storeRef;
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    storeRef = (await load(STORE_PATH)) as StoreHandle;
    return storeRef;
  } catch (error) {
    console.warn("Kokoro cache: failed to load store", error);
    return null;
  }
};

const readAssets = async (): Promise<AssetDictionary> => {
  if (assetCache) return assetCache;
  const store = await getStore();
  if (!store) {
    assetCache = {};
    return assetCache;
  }
  const stored = (await store.get<AssetDictionary>(STORE_KEY)) ?? {};
  assetCache = stored;
  return stored;
};

const writeAssets = async (assets: AssetDictionary) => {
  const store = await getStore();
  if (!store) return;
  assetCache = assets;
  await store.set(STORE_KEY, assets);
  await store.save();
};

export const isAssetCached = async (url: string) => {
  const assets = await readAssets();
  return Boolean(assets[url]);
};

const cacheAsset = async (url: string, response: Response, payload: ArrayBuffer) => {
  const assets = await readAssets();
  assets[url] = {
    data: arrayBufferToBase64(payload),
    status: response.status,
    statusText: response.statusText,
    headers: serializeHeaders(response.headers),
    timestamp: Date.now(),
  };
  await writeAssets(assets);
};

const getCachedAsset = async (url: string): Promise<Response | null> => {
  const assets = await readAssets();
  const cached = assets[url];
  if (!cached) return null;
  try {
    const buffer = base64ToArrayBuffer(cached.data);
    return new Response(buffer, {
      status: cached.status,
      statusText: cached.statusText,
      headers: deserializeHeaders(cached.headers),
    });
  } catch (error) {
    console.warn("Kokoro cache: unable to hydrate cached asset", error);
    return null;
  }
};

const resolveUrlFromInput = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url ?? "";
};

export const ensureKokoroAssetFetchCache = () => {
  if (fetchPatched || typeof window === "undefined" || typeof fetch !== "function") {
    return;
  }
  if (!isTauriEnvironment()) {
    fetchPatched = true;
    return;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const targetUrl = resolveUrlFromInput(input);
    const shouldCache = shouldHandleUrl(targetUrl);

    if (shouldCache) {
      const cached = await getCachedAsset(targetUrl);
      if (cached) {
        return cached;
      }
    }

    const response = await originalFetch(input as RequestInfo, init);

    if (shouldCache && response.ok) {
      const clone = response.clone();
      const payload = await clone.arrayBuffer();
      await cacheAsset(targetUrl, response, payload);
      return new Response(payload, {
        status: response.status,
        statusText: response.statusText,
        headers: serializeHeaders(response.headers),
      });
    }

    return response;
  };

  fetchPatched = true;
};

export const getCachedAssetStats = async () => {
  const assets = await readAssets();
  const entries = Object.entries(assets);
  const totalBytes = entries.reduce((sum, [, value]) => sum + atob(value.data).length, 0);
  return { count: entries.length, totalBytes };
};
