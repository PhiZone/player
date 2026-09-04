/**
 * Chart storage — unified facade.
 *
 * Dispatches to the IndexedDB backend (browser) or the folder-on-disk
 * backend (Tauri / browser-with-backend) based on the environment,
 * mirroring how `respackStorage.ts` is consumed but one level up.
 */

import type { Metadata, StoredChart, StoredChartSummary } from '$lib/types';
import { sha256Hex, uuid } from '$lib/utils';
import { openDB } from './idb';
import { memStore } from './memStore';
import {
  deleteChartFromDisk,
  loadChartFromDisk,
  loadChartSummariesFromDisk,
  saveChartToDisk,
} from './chartStorageTauri';

const STORE_NAME = 'charts';

/** Check for Tauri without importing from $lib/utils to avoid circular deps. */
const isTauriLike = () =>
  (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) ||
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('backend'));

interface StoredFile {
  data: Blob;
  name: string;
  type: string;
}

interface StoredChartRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  checksum?: string;
  sourceName?: string;
  onlineId?: string;
  metadata: Metadata;
  resources: { chart: StoredFile; song: StoredFile; illustration: StoredFile };
  assets: { name: string; type: number; file: StoredFile; included: boolean }[];
}

function fileToStored(file: File): StoredFile {
  return { data: file.slice(), name: file.name, type: file.type };
}

function storedToFile(stored: StoredFile): File {
  return new File([stored.data], stored.name, { type: stored.type });
}

function packChart(chart: StoredChart): StoredChartRecord {
  return {
    id: chart.id,
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
    checksum: chart.checksum,
    sourceName: chart.sourceName,
    onlineId: chart.onlineId,
    metadata: chart.metadata,
    resources: {
      chart: fileToStored(chart.resources.chart),
      song: fileToStored(chart.resources.song),
      illustration: fileToStored(chart.resources.illustration),
    },
    assets: chart.assets.map((asset) => ({
      name: asset.name,
      type: asset.type,
      file: fileToStored(asset.file),
      included: asset.included,
    })),
  };
}

function unpackChart(record: StoredChartRecord): StoredChart {
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    checksum: record.checksum,
    sourceName: record.sourceName,
    onlineId: record.onlineId,
    metadata: record.metadata,
    resources: {
      chart: storedToFile(record.resources.chart),
      song: storedToFile(record.resources.song),
      illustration: storedToFile(record.resources.illustration),
    },
    assets: record.assets.map((asset) => ({
      name: asset.name,
      type: asset.type,
      file: storedToFile(asset.file),
      included: asset.included,
    })),
  };
}

/** A summary's illustration *is* the library thumbnail. If a record was left
 * truncated by an interrupted/quota-failed write (missing `resources`, or a
 * non-blob illustration), emit no summary at all — masking the card (the
 * thumbnails are the same blob the detail page shows) instead of crashing
 * the whole grid with a `URL.createObjectURL(undefined)` error. */
function recordToSummary(record: StoredChartRecord): StoredChartSummary | null {
  const illustration = record.resources?.illustration;
  if (!illustration || typeof illustration !== 'object' || !(illustration.data instanceof Blob)) {
    return null;
  }
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    checksum: record.checksum,
    sourceName: record.sourceName,
    onlineId: record.onlineId,
    metadata: record.metadata,
    illustration,
  };
}

const toSummaries = (records: StoredChartRecord[]): StoredChartSummary[] =>
  records
    .map(recordToSummary)
    .filter((s): s is StoredChartSummary => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);

/** Any IndexedDB failure falls back to the session memory store so the app
 * keeps working for the page's lifetime instead of throwing (blocked opens,
 * quota errors and unavailable storage all surface as "chart/thumbnail
 * lost"), and reads merge the memory store so saves survive until reload. */
async function saveChartToIDB(chart: StoredChart): Promise<void> {
  const stored = packChart(chart);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(stored);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    memStore.put(STORE_NAME, stored.id, stored);
  }
}

async function loadAllChartSummariesFromIDB(): Promise<StoredChartSummary[]> {
  const mem = toSummaries(memStore.getAll<StoredChartRecord>(STORE_NAME));
  try {
    const db = await openDB();
    const records = await new Promise<StoredChartRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        db.close();
        resolve(request.result as StoredChartRecord[]);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
    const summaries = toSummaries(records);
    const seen = new Set(summaries.map((s) => s.id));
    for (const m of mem) if (!seen.has(m.id)) summaries.push(m);
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries;
  } catch {
    return mem;
  }
}

async function loadChartFromIDB(id: string): Promise<StoredChart> {
  try {
    const db = await openDB();
    const record = await new Promise<StoredChartRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        db.close();
        resolve(request.result as StoredChartRecord | undefined);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
    if (!record) throw new Error(`Stored chart not found: ${id}`);
    return unpackChart(record);
  } catch (e) {
    const record = memStore.get<StoredChartRecord>(STORE_NAME, id);
    if (record) return unpackChart(record);
    throw e;
  }
}

async function deleteChartFromIDB(id: string): Promise<void> {
  memStore.delete(STORE_NAME, id);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // The memory copy is already gone; ignore IDB failures.
  }
}

// ── Unified facade ────────────────────────────────────────────────────

export async function saveChart(chart: StoredChart): Promise<void> {
  if (isTauriLike()) return saveChartToDisk(chart);
  return saveChartToIDB(chart);
}

export async function loadAllChartSummaries(): Promise<StoredChartSummary[]> {
  if (isTauriLike()) return loadChartSummariesFromDisk();
  return loadAllChartSummariesFromIDB();
}

export async function loadChart(id: string): Promise<StoredChart> {
  if (isTauriLike()) return loadChartFromDisk(id);
  return loadChartFromIDB(id);
}

export async function deleteChart(id: string): Promise<void> {
  if (isTauriLike()) return deleteChartFromDisk(id);
  return deleteChartFromIDB(id);
}

/** Upsert a chart, normalizing identity fields. */
export async function syncChart(chart: StoredChart): Promise<void> {
  const normalized: StoredChart = {
    ...chart,
    id: chart.id || uuid(),
    createdAt: chart.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await saveChart(normalized);
}

/**
 * Deterministic content checksum (SHA-256) over chart + song + illustration
 * + assets bytes. Asset order is normalized by name so identical batches
 * hash identically regardless of insertion order.
 */
export async function computeChartChecksum(chart: StoredChart): Promise<string> {
  const digestFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return sha256Hex(bytes);
  };
  const fileDigests = [
    ['chart', chart.resources.chart.name, await digestFile(chart.resources.chart)],
    ['song', chart.resources.song.name, await digestFile(chart.resources.song)],
    [
      'illustration',
      chart.resources.illustration.name,
      await digestFile(chart.resources.illustration),
    ],
  ];
  const assets = [...chart.assets].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return nameCompare || a.type - b.type || a.name.localeCompare(b.name);
  });
  for (const asset of assets) {
    fileDigests.push([asset.name, String(asset.type), await digestFile(asset.file)]);
  }
  return sha256Hex(JSON.stringify(fileDigests));
}
