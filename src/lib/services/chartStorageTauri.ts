/**
 * Chart storage for Tauri (native or browser-with-backend).
 *
 * Layout: `<appDataDir>/charts/<chartId>/manifest.json` + one raw file per
 * stored resource/asset (sanitized filenames, collision-suffixed).
 * Summaries read only `manifest.json` (+ illustration bytes for the grid
 * thumbnail); full files are loaded lazily on chart open.
 */

import type { Metadata, StoredChart, StoredChartSummary } from '$lib/types';
import {
  fsMkdir,
  fsReadDir,
  fsReadFile,
  fsRemove,
  fsWriteFile,
  pathAppDataDir,
  pathJoin,
} from './tauriFsBridge';

interface ChartManifest {
  id: string;
  createdAt: number;
  updatedAt: number;
  checksum?: string;
  sourceName?: string;
  onlineId?: string;
  metadata: Metadata;
  resources: { chart: string; song: string; illustration: string };
  assets: { name: string; type: number; file: string; included: boolean }[];
}

interface StoredFile {
  data: Blob;
  name: string;
  type: string;
}

const chartsRootDir = async () => pathJoin(await pathAppDataDir(), 'charts');

const chartDir = async (id: string) => pathJoin(await chartsRootDir(), id);

const sanitizeFilename = (name: string): string => {
  // Strip any path segments, keep only a filesystem-safe basename.
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
};

/** Map original names → unique sanitized filenames (dedup with -2, -3…). */
const planFilenames = (names: string[]): string[] => {
  const seen = new Set<string>();
  return names.map((name) => {
    const base = sanitizeFilename(name);
    let candidate = base;
    let i = 2;
    while (seen.has(candidate)) {
      const dot = base.lastIndexOf('.');
      candidate = dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`;
      i++;
    }
    seen.add(candidate);
    return candidate;
  });
};

const readManifest = async (id: string): Promise<ChartManifest | null> => {
  try {
    const dir = await chartDir(id);
    const bytes = await fsReadFile(await pathJoin(dir, 'manifest.json'));
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as ChartManifest;
  } catch (e) {
    console.warn(`Failed to read manifest for chart ${id}:`, e);
    return null;
  }
};

const readStoredFile = async (dir: string, filename: string): Promise<StoredFile> => {
  const bytes = await fsReadFile(await pathJoin(dir, filename));
  const data = new Blob([bytes as unknown as BlobPart]);
  return { data, name: filename, type: data.type };
};

export async function saveChartToDisk(chart: StoredChart): Promise<void> {
  const root = await chartsRootDir();
  await fsMkdir(root, { recursive: true });
  const dir = await chartDir(chart.id);
  await fsMkdir(dir, { recursive: true });

  const allNames = [
    chart.resources.chart.name,
    chart.resources.song.name,
    chart.resources.illustration.name,
    ...chart.assets.map((asset) => asset.name),
  ];
  const filenames = planFilenames(allNames);
  const [chartFile, songFile, illustrationFile, ...assetFiles] = filenames;

  const toBytes = async (file: File) => new Uint8Array(await file.arrayBuffer());

  await fsWriteFile(await pathJoin(dir, chartFile), await toBytes(chart.resources.chart));
  await fsWriteFile(await pathJoin(dir, songFile), await toBytes(chart.resources.song));
  await fsWriteFile(
    await pathJoin(dir, illustrationFile),
    await toBytes(chart.resources.illustration),
  );
  const assets = chart.assets.map((asset, i) => ({
    name: asset.name,
    type: asset.type,
    file: assetFiles[i],
    included: asset.included,
  }));
  for (const asset of assets) {
    const file = chart.assets.find((a) => a.name === asset.name);
    if (file) {
      await fsWriteFile(await pathJoin(dir, asset.file), await toBytes(file.file));
    }
  }

  const manifest: ChartManifest = {
    id: chart.id,
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
    checksum: chart.checksum,
    sourceName: chart.sourceName,
    onlineId: chart.onlineId,
    metadata: chart.metadata,
    resources: {
      chart: chartFile,
      song: songFile,
      illustration: illustrationFile,
    },
    assets,
  };
  // Write manifest last so partially-written chart folders are not loaded.
  const encoder = new TextEncoder();
  await fsWriteFile(
    await pathJoin(dir, 'manifest.json'),
    encoder.encode(JSON.stringify(manifest, null, 2)),
  );
}

export async function loadChartSummariesFromDisk(): Promise<StoredChartSummary[]> {
  const root = await chartsRootDir();
  let entries;
  try {
    entries = await fsReadDir(root);
  } catch {
    return [];
  }
  const results: StoredChartSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDir) continue;
    try {
      const manifest = await readManifest(entry.name);
      if (!manifest) continue;
      const dir = await chartDir(manifest.id);
      let illustration: StoredFile | undefined;
      try {
        illustration = await readStoredFile(dir, manifest.resources.illustration);
      } catch {
        illustration = undefined;
      }
      results.push({
        id: manifest.id,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        checksum: manifest.checksum,
        sourceName: manifest.sourceName,
        onlineId: manifest.onlineId,
        metadata: manifest.metadata,
        illustration: illustration
          ? { data: illustration.data, name: illustration.name, type: illustration.type }
          : undefined,
      });
    } catch (e) {
      console.warn('Failed to read stored chart summary:', e);
    }
  }
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  return results;
}

export async function loadChartFromDisk(id: string): Promise<StoredChart> {
  const manifest = await readManifest(id);
  if (!manifest) {
    throw new Error(`Stored chart not found: ${id}`);
  }
  const dir = await chartDir(id);
  const toFile = (stored: StoredFile) =>
    new File([stored.data], stored.name, { type: stored.type });
  const chartStored = await readStoredFile(dir, manifest.resources.chart);
  const songStored = await readStoredFile(dir, manifest.resources.song);
  const illustrationStored = await readStoredFile(dir, manifest.resources.illustration);
  const assetFiles = await Promise.all(
    manifest.assets.map(async (asset) => ({
      name: asset.name,
      type: asset.type,
      included: asset.included,
      file: toFile(await readStoredFile(dir, asset.file)),
    })),
  );
  return {
    id: manifest.id,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    checksum: manifest.checksum,
    sourceName: manifest.sourceName,
    onlineId: manifest.onlineId,
    metadata: manifest.metadata,
    resources: {
      chart: toFile(chartStored),
      song: toFile(songStored),
      illustration: toFile(illustrationStored),
    },
    assets: assetFiles,
  };
}

export async function deleteChartFromDisk(id: string): Promise<void> {
  await fsRemove(await chartDir(id), { recursive: true });
}
