/**
 * Chart storage — unified facade.
 *
 * Dispatches to the IndexedDB backend (browser) or the folder-on-disk
 * backend (Tauri / browser-with-backend) based on the environment,
 * mirroring how `respackStorage.ts` is consumed but one level up.
 */

import type { Metadata, StoredChart, StoredChartSummary } from '$lib/types';
import { openDB } from './idb';
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

function recordToSummary(record: StoredChartRecord): StoredChartSummary {
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    checksum: record.checksum,
    sourceName: record.sourceName,
    metadata: record.metadata,
    illustration: record.resources.illustration,
  };
}

async function saveChartToIDB(chart: StoredChart): Promise<void> {
  const db = await openDB();
  const stored = packChart(chart);
  return new Promise((resolve, reject) => {
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
}

async function loadAllChartSummariesFromIDB(): Promise<StoredChartSummary[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      const records = request.result as StoredChartRecord[];
      const summaries = records.map(recordToSummary);
      summaries.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(summaries);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function loadChartFromIDB(id: string): Promise<StoredChart> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      db.close();
      const record = request.result as StoredChartRecord | undefined;
      if (!record) {
        reject(new Error(`Stored chart not found: ${id}`));
        return;
      }
      resolve(unpackChart(record));
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function deleteChartFromIDB(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
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
    id: chart.id || crypto.randomUUID(),
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
  const encoder = new TextEncoder();
  const digestFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
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
  const canonical = encoder.encode(JSON.stringify(fileDigests));
  const digest = await crypto.subtle.digest('SHA-256', canonical);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
