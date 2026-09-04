/**
 * Small settings store with browser storage first and Toy cloud as fallback.
 * Large chart, resource-pack and FFmpeg blobs never go through this module.
 */

import { isIdbAvailable, openDB } from './idb';
import { toyCloudGet, toyCloudRemove, toyCloudSet, toyCloudStorageAvailable } from './toy';

const SETTINGS_STORE = 'settings';
const STORAGE_PROBE_KEY = '__phizone_player_storage_probe__';

const DURABLE_KEYS = new Set([
  'preferences',
  'toggles',
  'mediaOptions',
  'selectedResourcePack',
  'lastLandingTab',
  'duplicateImportChoice',
]);

type SettingsBackend = 'localStorage' | 'indexedDB' | 'cloud' | 'memory';
type ReadResult = { ok: boolean; value: string | null };
interface StoredSetting {
  key: string;
  value: string;
}

let localStorageReady: boolean | null = null;
let selectedBackend: SettingsBackend | undefined;
let backendPromise: Promise<SettingsBackend> | undefined;
const memorySettings = new Map<string, string>();

function probeLocalStorage(): boolean {
  if (localStorageReady !== null) return localStorageReady;
  if (typeof window === 'undefined') return false;
  try {
    const value = String(Date.now());
    localStorage.setItem(STORAGE_PROBE_KEY, value);
    localStorageReady = localStorage.getItem(STORAGE_PROBE_KEY) === value;
    localStorage.removeItem(STORAGE_PROBE_KEY);
  } catch {
    localStorageReady = false;
  }
  return localStorageReady;
}

function readLocalSetting(key: string): ReadResult {
  if (!probeLocalStorage()) return { ok: false, value: null };
  try {
    return { ok: true, value: localStorage.getItem(key) };
  } catch {
    localStorageReady = false;
    return { ok: false, value: null };
  }
}

function writeLocalSetting(key: string, value: string): boolean {
  if (!probeLocalStorage()) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    localStorageReady = false;
    return false;
  }
}

function removeLocalSetting(key: string): boolean {
  if (!probeLocalStorage()) return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    localStorageReady = false;
    return false;
  }
}

async function readIndexedSetting(key: string): Promise<ReadResult> {
  if (!(await isIdbAvailable())) return { ok: false, value: null };
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const result = await new Promise<StoredSetting | undefined>((resolve, reject) => {
      const request = db!
        .transaction(SETTINGS_STORE, 'readonly')
        .objectStore(SETTINGS_STORE)
        .get(key);
      request.onsuccess = () => resolve(request.result as StoredSetting | undefined);
      request.onerror = () => reject(request.error ?? new Error('Failed to read setting'));
    });
    return { ok: true, value: result?.value ?? null };
  } catch {
    return { ok: false, value: null };
  } finally {
    db?.close();
  }
}

async function writeIndexedSetting(key: string, value: string): Promise<boolean> {
  if (!(await isIdbAvailable())) return false;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put({ key, value } satisfies StoredSetting);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to write setting'));
      tx.onabort = () => reject(tx.error ?? new Error('Setting write aborted'));
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

async function removeIndexedSetting(key: string): Promise<boolean> {
  if (!(await isIdbAvailable())) return false;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to remove setting'));
      tx.onabort = () => reject(tx.error ?? new Error('Setting removal aborted'));
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

async function selectBackend(): Promise<SettingsBackend> {
  if (probeLocalStorage()) return 'localStorage';
  if (await isIdbAvailable()) return 'indexedDB';
  if (await toyCloudStorageAvailable()) return 'cloud';
  return 'memory';
}

async function getBackend(): Promise<SettingsBackend> {
  if (selectedBackend) return selectedBackend;
  backendPromise ??= selectBackend().then((backend) => {
    selectedBackend = backend;
    return backend;
  });
  return backendPromise;
}

async function readAfterBrowserFailure(key: string): Promise<string | null> {
  if (await isIdbAvailable()) {
    const result = await readIndexedSetting(key);
    if (result.ok) {
      selectedBackend = 'indexedDB';
      return result.value;
    }
  }
  if (DURABLE_KEYS.has(key) && (await toyCloudStorageAvailable())) {
    const value = await toyCloudGet(key);
    if (value !== null) {
      selectedBackend = 'cloud';
      return value;
    }
  }
  return memorySettings.get(key) ?? null;
}

export async function toySettingsGet(key: string): Promise<string | null> {
  const backend = await getBackend();
  if (backend === 'localStorage') {
    const result = readLocalSetting(key);
    return result.ok ? result.value : readAfterBrowserFailure(key);
  }
  if (backend === 'indexedDB') {
    const result = await readIndexedSetting(key);
    return result.ok ? result.value : readAfterBrowserFailure(key);
  }
  if (backend === 'cloud' && DURABLE_KEYS.has(key)) return toyCloudGet(key);
  return memorySettings.get(key) ?? null;
}

export async function toySettingsSet(key: string, value: string): Promise<void> {
  const backend = await getBackend();
  if (backend === 'localStorage' && writeLocalSetting(key, value)) return;
  if (await writeIndexedSetting(key, value)) {
    selectedBackend = 'indexedDB';
    return;
  }
  if (
    DURABLE_KEYS.has(key) &&
    (await toyCloudStorageAvailable()) &&
    (await toyCloudSet(key, value))
  ) {
    selectedBackend = 'cloud';
    return;
  }
  memorySettings.set(key, value);
}

export async function toySettingsRemove(key: string): Promise<void> {
  const backend = await getBackend();
  if (backend === 'localStorage' && removeLocalSetting(key)) return;
  if (await removeIndexedSetting(key)) {
    selectedBackend = 'indexedDB';
    return;
  }
  if (DURABLE_KEYS.has(key) && (await toyCloudStorageAvailable())) {
    await toyCloudRemove(key);
    selectedBackend = 'cloud';
    return;
  }
  memorySettings.delete(key);
}
