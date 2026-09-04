const DB_NAME = 'phizone_player';
const DB_VERSION = 3;

const STORES: Record<string, IDBObjectStoreParameters> = {
  resource_packs: { keyPath: 'id' },
  ffmpeg: { keyPath: 'key' },
  charts: { keyPath: 'id' },
};

const enum IdbState {
  Unknown = 0,
  Ready = 1,
  Blocked = 2,
  Unavailable = 3,
}

let state: IdbState = IdbState.Unknown;
let openPromise: Promise<IDBDatabase> | null = null;

/**
 * Open the database. On success the database is cached for the session.
 *
 * If IndexedDB is unavailable (sandboxed iframe with storage partitioned/off,
 * private browsing, thorough security policy) or blocked by a version change
 * from another tab, `open` rejects and callers should fall back to a
 * session-only store so library / respack / ffmpeg features keep working
 * for the duration of the page instead of throwing everywhere.
 */
const doOpen = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
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
      state = IdbState.Ready;
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
    request.onblocked = () => {
      reject(new Error('IndexedDB open blocked by another connection'));
    };
  });

export function openDB(): Promise<IDBDatabase> {
  if (state === IdbState.Unavailable) {
    return Promise.reject(new Error('IndexedDB is unavailable in this environment'));
  }
  if (state === IdbState.Ready && openPromise) return openPromise;
  if (state === IdbState.Blocked) {
    // A version-change block is transient; try again so a reload or another
    // tab closing can clear it.
    state = IdbState.Unknown;
  }
  openPromise ??= doOpen().catch((e: unknown) => {
    // Remember only definitively-unavailable states so we don't hammer every
    // call; transient blocked states retry on the next call.
    const err = e instanceof Error ? e : new Error(String(e));
    if (/(blocked|SecurityError|InvalidStateError|NotSupportedError)/i.test(err.message)) {
      state = IdbState.Unavailable;
    }
    throw err;
  });
  return openPromise;
}

/** True once a successful open has happened this session. */
export function isIdbAvailable(): boolean {
  return state === IdbState.Ready;
}
