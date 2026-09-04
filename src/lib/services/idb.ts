const DB_NAME = 'phizone_player';
const DB_VERSION = 4;
const IDB_OPEN_TIMEOUT_MS = 3000;

const STORES: Record<string, IDBObjectStoreParameters> = {
  resource_packs: { keyPath: 'id' },
  ffmpeg: { keyPath: 'key' },
  charts: { keyPath: 'id' },
  settings: { keyPath: 'key' },
};

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      handler();
    };
    timeout = setTimeout(
      () => finish(() => reject(new Error('Timed out opening IndexedDB'))),
      IDB_OPEN_TIMEOUT_MS,
    );
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, options] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, options);
        }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      finish(() => resolve(database));
    };
    request.onerror = () =>
      finish(() => reject(request.error ?? new Error('Failed to open IndexedDB')));
    request.onblocked = () => finish(() => reject(new Error('IndexedDB open blocked')));
  });
}

let idbProbePromise: Promise<boolean> | null = null;

async function probeIndexedDB(): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const key = `__probe_${Date.now()}_${Math.random()}`;
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction('settings', 'readwrite');
      try {
        const store = tx.objectStore('settings');
        store.put({ key, value: '1' });
        store.delete(key);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB probe failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB probe aborted'));
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** Probe an actual read/write transaction, not just the IndexedDB global. */
export function isIdbAvailable(): Promise<boolean> {
  idbProbePromise ??= probeIndexedDB();
  return idbProbePromise;
}
