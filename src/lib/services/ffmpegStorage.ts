import { openDB } from './idb';
import { memStore } from './memStore';

const STORE_NAME = 'ffmpeg';
const IDB_OPERATION_TIMEOUT_MS = 3000;

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
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        db.close();
        handler();
      };
      try {
        store.put({ key, data: blob } satisfies StoredFFmpegBlob);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      timeout = setTimeout(() => {
        try {
          tx.abort();
        } catch {}
        finish(() => reject(new Error('Timed out writing FFmpeg cache')));
      }, IDB_OPERATION_TIMEOUT_MS);
      tx.oncomplete = () => {
        finish(() => {
          memStore.delete(STORE_NAME, key);
          resolve();
        });
      };
      tx.onerror = () =>
        finish(() => reject(tx.error ?? new Error('Failed to write FFmpeg cache')));
      tx.onabort = () => finish(() => reject(tx.error ?? new Error('FFmpeg cache write aborted')));
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
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (handler: () => void) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        db.close();
        handler();
      };
      request.onsuccess = () => {
        const stored = request.result as StoredFFmpegBlob | undefined;
        finish(() =>
          resolve(memStore.get<StoredFFmpegBlob>(STORE_NAME, key)?.data ?? stored?.data ?? null),
        );
      };
      request.onerror = () =>
        finish(() => reject(request.error ?? new Error('Failed to read FFmpeg cache')));
      tx.onerror = () => finish(() => reject(tx.error ?? new Error('Failed to read FFmpeg cache')));
      tx.onabort = () => finish(() => reject(tx.error ?? new Error('FFmpeg cache read aborted')));
      timeout = setTimeout(() => {
        try {
          tx.abort();
        } catch {}
        finish(() => reject(new Error('Timed out reading FFmpeg cache')));
      }, IDB_OPERATION_TIMEOUT_MS);
    });
  } catch {
    return memStore.get<StoredFFmpegBlob>(STORE_NAME, key)?.data ?? null;
  }
}
