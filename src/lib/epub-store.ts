/**
 * Store for EPUB buffers using Tauri store plugin
 * Stores both original and converted audiobook EPUBs as base64-encoded strings
 * Uses the same pattern as usePersistentLibrary.ts for consistency
 */

import { logger } from "./logger";

const STORE_PATH = "epub-cache.store.json";
const STORE_KEY_PREFIX = "epub:";
const EPUB_STORE_LOG_PREFIX = "[EPUBStore]";

type StoreHandle = {
  set: (key: string, value: unknown) => Promise<void>;
  get: <T>(key: string) => Promise<T | null | undefined>;
  save: () => Promise<void>;
  delete: (key: string) => Promise<boolean>;
};

let storeRef: StoreHandle | null = null;

const getStore = async (): Promise<StoreHandle | null> => {
  if (storeRef) {
    logger.debug(`${EPUB_STORE_LOG_PREFIX} using cached store reference`);
    return storeRef;
  }

  try {
    logger.debug(`${EPUB_STORE_LOG_PREFIX} loading store from ${STORE_PATH}`);
    const { load } = await import("@tauri-apps/plugin-store");
    storeRef = (await load(STORE_PATH)) as StoreHandle;
    logger.debug(`${EPUB_STORE_LOG_PREFIX} store loaded successfully`);
    return storeRef;
  } catch (error) {
    logger.error(`${EPUB_STORE_LOG_PREFIX} failed to load store`, {
      error,
      storePath: STORE_PATH,
    });
    return null;
  }
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToArrayBuffer = (value: string): ArrayBuffer => {
  const binary = atob(value);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Store a converted EPUB buffer for a book
 * Uses sourcePath as key since it's stable across re-ingestions
 */
export const storeConvertedEpub = async (sourcePath: string, buffer: ArrayBuffer): Promise<void> => {
  const store = await getStore();
  if (!store) {
    logger.warn(`${EPUB_STORE_LOG_PREFIX} store not available, cannot save converted EPUB`);
    throw new Error("Store not available");
  }

  try {
    const key = `${STORE_KEY_PREFIX}${sourcePath}`;
    
    // Check buffer size - warn if very large
    const sizeMB = buffer.byteLength / (1024 * 1024);
    if (sizeMB > 100) {
      logger.warn(`${EPUB_STORE_LOG_PREFIX} EPUB is very large (${sizeMB.toFixed(2)}MB), storage may be slow`);
    }
    
    const base64Data = arrayBufferToBase64(buffer);
    logger.debug(`${EPUB_STORE_LOG_PREFIX} storing converted EPUB`, {
      sourcePath,
      key,
      sizeBytes: buffer.byteLength,
      sizeMB: sizeMB.toFixed(2),
      base64Length: base64Data.length,
    });
    
    // Set the value
    await store.set(key, base64Data);
    logger.debug(`${EPUB_STORE_LOG_PREFIX} set value in store, now saving...`);
    
    // Save the store - this is critical
    await store.save();
    logger.debug(`${EPUB_STORE_LOG_PREFIX} store.save() completed`);
    
    // Small delay to ensure store is fully persisted
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify it was stored correctly
    const verify = await store.get<string>(key);
    if (!verify) {
      logger.error(`${EPUB_STORE_LOG_PREFIX} verification failed - EPUB was not stored!`, {
        key,
        sourcePath,
      });
      throw new Error("Failed to verify EPUB storage - data was not persisted");
    }
    
    if (verify.length !== base64Data.length) {
      logger.error(`${EPUB_STORE_LOG_PREFIX} verification failed - size mismatch!`, {
        expected: base64Data.length,
        actual: verify.length,
        key,
        sourcePath,
      });
      throw new Error(`Failed to verify EPUB storage - size mismatch (expected ${base64Data.length}, got ${verify.length})`);
    }
    
    logger.debug(`${EPUB_STORE_LOG_PREFIX} stored and verified converted EPUB successfully`, {
      sourcePath,
      sizeBytes: buffer.byteLength,
      storedSize: verify.length,
    });
  } catch (error) {
    logger.error(`${EPUB_STORE_LOG_PREFIX} failed to store converted EPUB`, {
      error,
      sourcePath,
      bufferSize: buffer.byteLength,
    });
    throw error;
  }
};

/**
 * Retrieve a converted EPUB buffer for a book
 * Uses sourcePath as key since it's stable across re-ingestions
 */
export const getConvertedEpub = async (sourcePath: string): Promise<ArrayBuffer | null> => {
  const store = await getStore();
  if (!store) {
    logger.warn(`${EPUB_STORE_LOG_PREFIX} store not available, cannot retrieve converted EPUB`);
    return null;
  }

  try {
    const key = `${STORE_KEY_PREFIX}${sourcePath}`;
    logger.debug(`${EPUB_STORE_LOG_PREFIX} retrieving converted EPUB`, {
      sourcePath,
      key,
    });
    const base64Data = await store.get<string>(key);
    if (!base64Data) {
      logger.debug(`${EPUB_STORE_LOG_PREFIX} converted EPUB not found in store`, {
        sourcePath,
        key,
      });
      return null;
    }
    const buffer = base64ToArrayBuffer(base64Data);
    logger.debug(`${EPUB_STORE_LOG_PREFIX} retrieved converted EPUB successfully`, {
      sourcePath,
      sizeBytes: buffer.byteLength,
      base64Length: base64Data.length,
    });
    return buffer;
  } catch (error) {
    logger.error(`${EPUB_STORE_LOG_PREFIX} failed to retrieve converted EPUB`, error);
    return null;
  }
};

/**
 * Store an original EPUB buffer for a book
 * Uses sourcePath as key since it's stable across re-ingestions
 */
export const storeOriginalEpub = async (sourcePath: string, buffer: ArrayBuffer): Promise<void> => {
  const store = await getStore();
  if (!store) {
    logger.warn(`${EPUB_STORE_LOG_PREFIX} store not available, cannot save original EPUB`);
    throw new Error("Store not available");
  }

  try {
    const key = `${STORE_KEY_PREFIX}${sourcePath}`;
    
    // Check buffer size - warn if very large
    const sizeMB = buffer.byteLength / (1024 * 1024);
    if (sizeMB > 100) {
      logger.warn(`${EPUB_STORE_LOG_PREFIX} EPUB is very large (${sizeMB.toFixed(2)}MB), storage may be slow`);
    }
    
    const base64Data = arrayBufferToBase64(buffer);
    logger.debug(`${EPUB_STORE_LOG_PREFIX} storing original EPUB`, {
      sourcePath,
      key,
      sizeBytes: buffer.byteLength,
      sizeMB: sizeMB.toFixed(2),
    });
    
    // Set the value
    await store.set(key, base64Data);
    await store.save();
    
    logger.debug(`${EPUB_STORE_LOG_PREFIX} stored original EPUB successfully`, {
      sourcePath,
      sizeBytes: buffer.byteLength,
    });
  } catch (error) {
    logger.error(`${EPUB_STORE_LOG_PREFIX} failed to store original EPUB`, {
      error,
      sourcePath,
      bufferSize: buffer.byteLength,
    });
    throw error;
  }
};

/**
 * Retrieve an EPUB buffer for a book (works for both original and converted)
 * Uses sourcePath as key since it's stable across re-ingestions
 */
export const getEpub = async (sourcePath: string): Promise<ArrayBuffer | null> => {
  const store = await getStore();
  if (!store) {
    logger.warn(`${EPUB_STORE_LOG_PREFIX} store not available, cannot retrieve EPUB`);
    return null;
  }

  try {
    const key = `${STORE_KEY_PREFIX}${sourcePath}`;
    const base64Data = await store.get<string>(key);
    if (!base64Data) {
      logger.debug(`${EPUB_STORE_LOG_PREFIX} EPUB not found in store`, {
        sourcePath,
        key,
      });
      return null;
    }
    const buffer = base64ToArrayBuffer(base64Data);
    logger.debug(`${EPUB_STORE_LOG_PREFIX} retrieved EPUB successfully`, {
      sourcePath,
      sizeBytes: buffer.byteLength,
    });
    return buffer;
  } catch (error) {
    logger.error(`${EPUB_STORE_LOG_PREFIX} failed to retrieve EPUB`, error);
    return null;
  }
};

/**
 * Remove an EPUB buffer for a book
 * Uses sourcePath as key since it's stable across re-ingestions
 */
export const removeEpub = async (sourcePath: string): Promise<void> => {
  const store = await getStore();
  if (!store) {
    return;
  }

  try {
    const key = `${STORE_KEY_PREFIX}${sourcePath}`;
    const deleted = await store.delete(key);
    if (deleted) {
      await store.save();
      logger.debug(`${EPUB_STORE_LOG_PREFIX} removed EPUB`, { sourcePath });
    }
  } catch (error) {
    logger.error(`${EPUB_STORE_LOG_PREFIX} failed to remove EPUB`, error);
  }
};

/**
 * Remove a converted EPUB buffer for a book (kept for backward compatibility)
 * @deprecated Use removeEpub instead
 */
export const removeConvertedEpub = removeEpub;

