/**
 * Durable settings for the Bilibili Toy environment.
 *
 * iOS Safari does not persist localStorage/IndexedDB for the cross-origin
 * sandboxed iframe that hosts Toy pages, so preferences/toggles/mediaOptions
 * and the selected resource pack would reset on every reload. The Toy SDK's
 * cloud storage (per user + toy, values ≤1024 bytes) is the only durable
 * store available there, and these small settings JSON blobs fit comfortably.
 *
 * This module mirrors the handful of localStorage keys the app uses for
 * settings, transparently backing them with Toy cloud storage when running
 * in a Toy environment and with localStorage everywhere else. Chart/respack/
 * ffmpeg blobs are intentionally NOT persisted here (they exceed the 1024-byte
 * value limit) — those stay session-only on Toy.
 */

import {
  toyCloudGet,
  toyCloudRemove,
  toyCloudSet,
  toyCloudStorageAvailable,
} from './toy';

/** Settings keys that are safe (and small enough) to persist to cloud. */
const DURABLE_KEYS = new Set([
  'preferences',
  'toggles',
  'mediaOptions',
  'selectedResourcePack',
  'lastLandingTab',
  'duplicateImportChoice',
]);

let cloudReady: boolean | null = null;

async function ready(): Promise<boolean> {
  if (cloudReady === null) cloudReady = await toyCloudStorageAvailable();
  return cloudReady;
}

/** Read a setting, preferring Toy cloud storage when available. */
export async function toySettingsGet(key: string): Promise<string | null> {
  if (DURABLE_KEYS.has(key) && (await ready())) {
    const value = await toyCloudGet(key);
    if (value !== null) return value;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a setting to Toy cloud storage (when available) and localStorage. */
export async function toySettingsSet(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage may be unavailable in the sandboxed iframe */
  }
  if (DURABLE_KEYS.has(key) && (await ready())) {
    await toyCloudSet(key, value);
  }
}

/** Remove a setting from Toy cloud storage and localStorage. */
export async function toySettingsRemove(key: string): Promise<void> {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  if (DURABLE_KEYS.has(key) && (await ready())) {
    await toyCloudRemove(key);
  }
}