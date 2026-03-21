const DB_NAME = 'phizone_player';
const DB_VERSION = 2;

const STORES: Record<string, IDBObjectStoreParameters> = {
  resource_packs: { keyPath: 'id' },
  ffmpeg: { keyPath: 'key' },
};

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, options] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, options);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
