/**
 * Chart storage — unified facade.
 *
 * Dispatches to the IndexedDB backend (browser) or the folder-on-disk
 * backend (Tauri / browser-with-backend) based on the environment,
 * mirroring how `respackStorage.ts` is consumed but one level up.
 */

import type { Metadata, StoredChart, StoredChartSummary } from '$lib/types';
import { sha256Hex, uuid } from '$lib/utils';
import { isIdbAvailable, openDB } from './idb';
import { memStore } from './memStore';
import { libraryApi } from './libraryApi';
import {
  toyGetChartMetadata,
  toyListChartMetadata,
  toyRemoveChartMetadata,
  toySaveChartMetadata,
  type ToyChartMeta,
} from './toy';
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
        memStore.delete(STORE_NAME, stored.id);
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
  const memoryRecords = memStore.getAll<StoredChartRecord>(STORE_NAME);
  const mem = toSummaries(memoryRecords);
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
    const recordsById = new Map(records.map((record) => [record.id, record]));
    for (const record of memoryRecords) recordsById.set(record.id, record);
    return toSummaries(Array.from(recordsById.values()));
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
    const memoryRecord = memStore.get<StoredChartRecord>(STORE_NAME, id);
    if (memoryRecord) return unpackChart(memoryRecord);
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

/**
 * Whether the environment offers durable browser storage (IndexedDB). Chart
 * payloads (multi-MB blobs) are only persisted when this is true. When it is
 * false, the app runs in "degraded" mode: online charts keep their metadata
 * on Toy cloud and are re-downloaded on demand, local charts stay session-only.
 *
 * Cached for the session (the probe runs a real read/write transaction).
 */
let durableStoragePromise: Promise<boolean> | undefined;
const durableStorageAvailable = () => (durableStoragePromise ??= isIdbAvailable());

function metaToSummary(meta: ToyChartMeta): StoredChartSummary {
  return {
    id: meta.onlineId,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    // Intentionally no checksum: the cloud-only placeholder must not match a
    // re-download's checksum dedup (its payload isn't stored), or the import
    // pipeline would treat a "need to download" chart as an existing copy.
    sourceName: meta.sourceName,
    onlineId: meta.onlineId,
    illustrationUrl: meta.illustrationUrl,
    metadata: {
      title: meta.title,
      composer: meta.composer,
      charter: meta.charter,
      illustrator: meta.illustrator,
      levelType: meta.levelType as Metadata['levelType'],
      level: meta.level,
      difficulty: null,
    },
  };
}

/** A summary that only exists in the Toy cloud registry (`degraded` mode).
 * IDB-stored online charts keep a UUID `id` separate from `onlineId`, while
 * degraded-registry entries use the onlineId directly as their id — so
 * `id === onlineId` unambiguously marks a registry-only card that has no
 * local payload attached.
 */
export function isCloudOnlySummary(
  summary: StoredChartSummary,
): summary is StoredChartSummary & { onlineId: string } {
  return (
    typeof summary.id === 'string' &&
    typeof summary.onlineId === 'string' &&
    summary.id === summary.onlineId
  );
}

/** Thrown by `loadChart` for a cloud-only entry that has no local payload. */
export class CloudOnlyChartError extends Error {
  constructor(
    public readonly onlineId: string,
    public readonly meta: ToyChartMeta,
  ) {
    super(`Online chart not downloaded yet: ${onlineId}`);
    this.name = 'CloudOnlyChartError';
  }
}

/** Best-effort online cover URL for an online chart, used so a cloud-only
 * card can show a thumbnail without re-downloading the payload. */
async function fetchOnlineCover(onlineId: string): Promise<string | undefined> {
  try {
    const detail = await libraryApi.getChart(onlineId);
    return detail.cover?.url ?? undefined;
  } catch {
    return undefined;
  }
}

export async function saveChart(chart: StoredChart): Promise<void> {
  if (isTauriLike()) return saveChartToDisk(chart);
  if (await durableStorageAvailable()) return saveChartToIDB(chart);
  // Degraded mode: only online charts can be re-downloaded, so only their
  // metadata is persisted. Local (non-online) charts have no download source,
  // so they stay session-only (memStore) and vanish on reload.
  if (!chart.onlineId) {
    memStore.put(STORE_NAME, chart.id, packChart(chart));
    return;
  }
  // Keep a session copy too so a chart re-downloaded this session can be
  // re-opened without hitting the network again. The cloud entry is what
  // survives a reload.
  memStore.put(STORE_NAME, chart.id, packChart(chart));
  // Best-effort cover URL: fetch it from the online API by id so the
  // cloud-only card has a thumbnail without re-downloading the payload. The
  // existing cloud entry's URL is reused when present (avoids an extra claim
  // call and survives API downtime).
  const priorMeta = await toyGetChartMetadata(chart.onlineId);
  let illustrationUrl = priorMeta?.illustrationUrl;
  if (!illustrationUrl) {
    illustrationUrl = await fetchOnlineCover(chart.onlineId);
  }
  const persisted = await toySaveChartMetadata({
    onlineId: chart.onlineId,
    title: chart.metadata.title,
    composer: chart.metadata.composer,
    charter: chart.metadata.charter,
    illustrator: chart.metadata.illustrator,
    levelType: chart.metadata.levelType,
    level: chart.metadata.level,
    sourceName: chart.sourceName,
    checksum: chart.checksum,
    illustrationUrl: illustrationUrl ?? undefined,
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
  });
  if (!persisted) {
    // Cloud write failed (e.g. value outgrew the 1 KB cap or SDK down): the
    // session copy above still keeps this session working.
    memStore.put(STORE_NAME, chart.id, packChart(chart));
  }
}

export async function loadAllChartSummaries(): Promise<StoredChartSummary[]> {
  if (isTauriLike()) return loadChartSummariesFromDisk();
  const idbSummaries = await loadAllChartSummariesFromIDB();
  // Merge any cloud-metadata entries (degraded-mode cards). We merge on
  // every read even when IDB is available (it may have come back between
  // writes) so a chart saved while degraded isn't lost.
  const cloudMetas = await toyListChartMetadata();
  if (cloudMetas.length === 0) return idbSummaries;
  const byOnlineId = new Map(idbSummaries.map((s) => [s.onlineId, s]));
  const merged = [...idbSummaries];
  for (const meta of cloudMetas) {
    if (byOnlineId.has(meta.onlineId)) continue;
    merged.push(metaToSummary(meta));
  }
  return merged.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadChart(id: string): Promise<StoredChart> {
  if (isTauriLike()) return loadChartFromDisk(id);
  try {
    return await loadChartFromIDB(id);
  } catch (e) {
    // A cloud-only summary (id == onlineId, no local blob) surfaces as a
    // `not found` here. Figure out whether this id has a cloud-metadata
    // entry and, if so, throw a typed error the caller can use to re-fetch.
    const metas = await toyListChartMetadata();
    const meta = metas.find((entry) => entry.onlineId === id);
    if (meta) throw new CloudOnlyChartError(meta.onlineId, meta);
    throw e;
  }
}

export async function deleteChart(id: string): Promise<void> {
  if (isTauriLike()) return deleteChartFromDisk(id);
  await deleteChartFromIDB(id);
  // Remove any cloud-metadata entry too, so an online chart deleted while
  // degraded (or after IDB recovered) clears both copies. The summary id is
  // the onlineId in degraded mode, so matching on it covers both paths.
  const metas = await toyListChartMetadata();
  const meta = metas.find((entry) => entry.onlineId === id);
  if (meta) {
    await toyRemoveChartMetadata(meta.onlineId);
  }
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
