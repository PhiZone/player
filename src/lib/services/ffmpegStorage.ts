import { openDB } from './idb';
import { memStore } from './memStore';

const STORE_NAME = 'ffmpeg';

interface StoredFFmpegBlob {
  key: string;
  data: Blob;
}

/** Any IndexedDB failure falls back to the session memory store: blocked
 * opens, quota errors (the 30 MB ffmpeg blobs are the largest writes and the
 * first to hit a Toy/iframe storage limit) and unavailable storage share the
 * same user-visible symptom and the same remedy — keep the session working. */
export async function saveFFmpegBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, data: blob } satisfies StoredFFmpegBlob);
      tx.oncomplete = () => {
        db.close();
        memStore.delete(STORE_NAME, key);
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    memStore.put(STORE_NAME, key, { key, data: blob } satisfies StoredFFmpegBlob);
  }
}

export async function loadFFmpegBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        db.close();
        const stored = request.result as StoredFFmpegBlob | undefined;
        resolve(memStore.get<StoredFFmpegBlob>(STORE_NAME, key)?.data ?? stored?.data ?? null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return memStore.get<StoredFFmpegBlob>(STORE_NAME, key)?.data ?? null;
  }
}
