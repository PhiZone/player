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

// ── Cross-session durability probe ─────────────────────────────────────
//
// The previous probe was a write-then-delete in one transaction, which only
// proved that writes *complete* — not that they *persist across reloads*.
// On the Toy page (a cross-origin sandboxed iframe on iOS/Android), IDB
// writes complete fine but the backing store is ephemeral: everything is
// discarded after the iframe reloads. The probe therefore reported
// "available" and the app persisted chart/ffmpeg/settings blobs into a store
// that silently vanished every navigation.
//
// The fix uses a cross-session sentinel: each load reads a fixed key written
// by a *previous* load. If it is present, the store truly survives reloads
// (durable). Ephemeral mobile storage can never produce a sentinel on read —
// our own write is discarded — so it is never trusted on the next load, and
// the app falls back to Toy cloud / session memory.
//
// Edge cases handled:
//  - Fresh durable profile (first ever load): no sentinel exists yet, but a
//    non-empty `charts` store is strong evidence those rows survived a prior
//    session, so durability is still confirmed. Otherwise the first load is
//    conservatively reported non-durable; the sentinel we write confirms it
//    on the following load.
//  - Existing desktop user: their published charts already populate the
//    `charts` store, so durability is confirmed immediately — no regression.
const DURABILITY_SENTINEL_KEY = '__phizone_durability_sentinel__';

let idbProbePromise: Promise<boolean> | null = null;

function writeSentinel(db: IDBDatabase): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: DURABILITY_SENTINEL_KEY, value: String(Date.now()) });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function readSentinel(db: IDBDatabase): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const request = db
        .transaction('settings', 'readonly')
        .objectStore('settings')
        .get(DURABILITY_SENTINEL_KEY);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** True when any chart rows already exist — durable evidence from a prior
 * session (ephemeral stores are empty on first mount). */
function hasPriorChartData(db: IDBDatabase): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction('charts', 'readonly').objectStore('charts').count();
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function probeIndexedDB(): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    // Proven durable: a sentinel written by a previous page load survived.
    const found = await readSentinel(db);
    if (found !== null) {
      await writeSentinel(db); // refresh the timestamp
      return true;
    }
    const priorData = await hasPriorChartData(db);
    await writeSentinel(db); // so the next load can confirm durability
    return priorData;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** Probe that IndexedDB *persists across reloads*, not just that it accepts
 * writes. Cached for the session. */
export function isIdbAvailable(): Promise<boolean> {
  idbProbePromise ??= probeIndexedDB();
  return idbProbePromise;
}
