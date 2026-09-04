/**
 * In-memory fallback when IndexedDB is unavailable (sandboxed iframes with
 * partitioned/blocked storage, private mode, or a policy that blocks it) or
 * when a storage quota error makes writes impossible.
 *
 * Objects are kept for the lifetime of the page — after a reload the data is
 * gone (IndexedDB itself is gone in this environment too, so nothing is
 * lost). The interface mirrors the object-store semantics the storage
 * services use: a Map keyed by the store's keyPath.
 */

const stores = new Map<string, Map<string, unknown>>();

function store(name: string): Map<string, unknown> {
  let map = stores.get(name);
  if (!map) {
    map = new Map();
    stores.set(name, map);
  }
  return map;
}

export const memStore = {
  get<T>(name: string, key: string): T | undefined {
    return store(name).get(key) as T | undefined;
  },
  getAll<T>(name: string): T[] {
    return Array.from(store(name).values()) as T[];
  },
  put<T>(name: string, key: string, value: T): void {
    store(name).set(key, value);
  },
  delete(name: string, key: string): void {
    store(name).delete(key);
  },
};
