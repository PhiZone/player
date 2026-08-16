/**
 * Within-batch chart grouping.
 *
 * Given the flat file list of one import batch (one ZIP, one folder tree,
 * or one multi-file drag/select), groups the files into per-chart records:
 *
 * 1. Partition by top-level folder path (zip entry paths / webkitRelativePath).
 * 2. Within each group, identify chart JSON/pec files and `extra.json`.
 * 3. Scan the chart JSON + extra.json for referenced asset names
 *    (judgeLine.Texture, videos[].path, effects[].shader when asset-relative).
 * 4. Assign assets: explicitly-referenced files always belong to the chart;
 *    in single-chart groups every remaining file is assigned; multi-chart
 *    groups only keep referenced / shareId-matched files.
 *
 * The returned `StoredChart` records carry the grouped files; callers can
 * override song/illustration/metadata with their own (already-resolved)
 * pipeline values, but the asset scoping is authoritative for per-chart
 * asset lists.
 */

import type { Metadata, RpeJson, StoredChart } from '$lib/types';
import { getLines, inferLevelType, isPec, readMetadataForChart, uuid } from '$lib/utils';

export interface ChartGroupInput {
  file: File;
  relativePath?: string;
}

export interface GroupedChart {
  chart: StoredChart;
  /** Files from the whole batch not assigned to any chart. */
  unmatched: ChartGroupInput[];
}

const getPath = (input: ChartGroupInput): string => input.relativePath || input.file.name;

const getFolderPath = (input: ChartGroupInput): string | null => {
  const idx = getPath(input).indexOf('/');
  return idx === -1 ? null : getPath(input).slice(0, idx);
};

const getBasename = (input: ChartGroupInput): string => {
  const parts = getPath(input).split('/');
  return parts[parts.length - 1];
};

const shareId = (a: string, b: string) =>
  a.split('.').slice(0, -1).join('.') === b.split('.').slice(0, -1).join('.');

/** 0 image, 1 audio, 2 video, 3 config, 4 shader, 5 font, 6 other. */
const classifyFile = (file: File): number => {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (
    file.type.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'apng'].includes(extension)
  ) {
    return 0;
  }
  if (
    file.type.startsWith('audio/') ||
    ['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'opus', 'wma'].includes(extension)
  ) {
    return 1;
  }
  if (
    file.type.startsWith('video/') ||
    ['mp4', 'webm', 'avi', 'mov', 'mkv', 'wmv'].includes(extension)
  ) {
    return 2;
  }
  if (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    ['yml', 'yaml'].includes(extension)
  ) {
    return 3;
  }
  if (['shader', 'glsl', 'frag', 'fsh', 'fs'].includes(extension)) return 4;
  if (['ttf', 'otf', 'woff', 'woff2'].includes(extension)) return 5;
  return 6;
};

const isChartFile = async (file: File): Promise<boolean> => {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.json') && !name.endsWith('.pec')) return false;
  try {
    const text = await file.text();
    if (name.endsWith('.json')) {
      const json = JSON.parse(text);
      if (json && json.META) return true;
      return false;
    }
    return isPec(getLines(text).slice(0, 2));
  } catch {
    return false;
  }
};

const getReferencedAssetNames = async (chartJson: File, extraJson?: File): Promise<Set<string>> => {
  const names = new Set<string>();
  const add = (value: string) => {
    const cleaned = value.replace(/^\//, '');
    if (cleaned) names.add(cleaned);
  };
  try {
    const json = JSON.parse(await chartJson.text()) as RpeJson;
    for (const line of json.judgeLineList ?? []) {
      if (line.Texture && line.Texture.toLowerCase() !== 'line.png') {
        add(line.Texture);
      }
    }
  } catch {
    // Not JSON (pec etc.) — no reference info.
  }
  if (extraJson) {
    try {
      const extra = JSON.parse(await extraJson.text());
      if (Array.isArray(extra.videos)) {
        for (const video of extra.videos) {
          if (video.path) add(String(video.path));
        }
      }
      if (Array.isArray(extra.effects)) {
        for (const effect of extra.effects) {
          if (effect.shader && String(effect.shader).startsWith('/')) {
            add(String(effect.shader));
          }
        }
      }
    } catch {
      // Ignore malformed extra.json.
    }
  }
  return names;
};

const isReferenced = (basename: string, referenced: Set<string>): boolean => {
  const stem = basename.split('.').slice(0, -1).join('.');
  for (const ref of referenced) {
    const refBasename = ref.split('/').pop() ?? ref;
    const refStem = refBasename.split('.').slice(0, -1).join('.');
    if (ref === basename || ref === stem || refBasename === basename || refStem === stem) {
      return true;
    }
  }
  return false;
};

const metadataToStored = (title: string): Metadata => ({
  title,
  composer: null,
  charter: null,
  illustrator: null,
  levelType: 2,
  level: null,
  difficulty: null,
});

export async function groupFilesIntoCharts(entries: ChartGroupInput[]): Promise<GroupedChart[]> {
  // Partition by top-level folder path.
  const folderGroups = new Map<string, ChartGroupInput[]>();
  const flat: ChartGroupInput[] = [];
  for (const entry of entries) {
    const folder = getFolderPath(entry);
    if (folder === null) {
      flat.push(entry);
    } else {
      const group = folderGroups.get(folder) ?? [];
      group.push(entry);
      folderGroups.set(folder, group);
    }
  }
  const partitioned: ChartGroupInput[][] = [];
  if (flat.length > 0) partitioned.push(flat);
  for (const group of folderGroups.values()) partitioned.push(group);

  // Classify each partition first, so that partitions without any chart
  // (e.g. assets living in zip subfolders next to the chart) can donate
  // their files to the batch's charts instead of being silently dropped.
  const classified = await Promise.all(
    partitioned.map(async (group) => {
      const charts: ChartGroupInput[] = [];
      let extra: ChartGroupInput | undefined;
      const others: ChartGroupInput[] = [];
      for (const entry of group) {
        const basename = getBasename(entry).toLowerCase();
        if (basename === 'extra.json') {
          extra = entry;
          continue;
        }
        if (await isChartFile(entry.file)) {
          charts.push(entry);
          continue;
        }
        others.push(entry);
      }
      return { charts, extra, others };
    }),
  );

  const chartGroups = classified.filter((group) => group.charts.length > 0);
  const totalCharts = chartGroups.reduce((sum, group) => sum + group.charts.length, 0);
  const singleChart = totalCharts === 1;

  // Files in chart-less partitions (e.g. `videos/` next to the chart folder).
  const orphanEntries: ChartGroupInput[] = [];
  for (const group of classified) {
    if (group.charts.length > 0) continue;
    if (group.extra) orphanEntries.push(group.extra);
    orphanEntries.push(...group.others);
  }
  const orphanAudios = orphanEntries.filter((entry) => classifyFile(entry.file) === 1);
  const orphanImages = orphanEntries.filter((entry) => classifyFile(entry.file) === 0);

  const results: GroupedChart[] = [];
  const assigned = new Set<ChartGroupInput>();

  for (const group of chartGroups) {
    const { charts, extra, others } = group;
    const multiChart = charts.length > 1;
    for (const chartEntry of charts) {
      const referenced = await getReferencedAssetNames(chartEntry.file, extra?.file);
      const audios = others.filter((e) => classifyFile(e.file) === 1);
      const images = others.filter((e) => classifyFile(e.file) === 0);

      let song = audios.find((a) => shareId(getBasename(a), getBasename(chartEntry)));
      if (!song && !multiChart) song = audios[0];
      // In a single-chart batch the song/illustration may live in a
      // subfolder (e.g. `music/song.mp3`) — look among the orphan files too.
      if (!song && singleChart) {
        song =
          orphanAudios.find((a) => shareId(getBasename(a), getBasename(chartEntry))) ??
          orphanAudios[0];
      }
      let illustration = images.find((i) => shareId(getBasename(i), getBasename(chartEntry)));
      if (!illustration && !multiChart) illustration = images[0];
      if (!illustration && singleChart) {
        illustration =
          orphanImages.find((i) => shareId(getBasename(i), getBasename(chartEntry))) ??
          orphanImages[0];
      }

      const claimed = new Set<ChartGroupInput>();
      if (song) claimed.add(song);
      if (illustration) claimed.add(illustration);

      const assetEntries: ChartGroupInput[] = [];
      // extra.json belongs to every chart in the group; without it charts
      // would lose their videos/effects once persisted and reloaded.
      if (extra) {
        assetEntries.push(extra);
        claimed.add(extra);
      }
      for (const entry of others) {
        if (claimed.has(entry)) continue;
        const basename = getBasename(entry);
        if (isReferenced(basename, referenced)) {
          assetEntries.push(entry);
          claimed.add(entry);
        }
      }
      if (!multiChart) {
        for (const entry of others) {
          if (!claimed.has(entry)) {
            assetEntries.push(entry);
            claimed.add(entry);
          }
        }
      }
      // Claim subfolder files: everything for a single-chart batch, only
      // files the chart explicitly references when the batch has multiple
      // charts.
      for (const entry of orphanEntries) {
        if (claimed.has(entry)) continue;
        if (singleChart || isReferenced(getBasename(entry), referenced)) {
          assetEntries.push(entry);
          claimed.add(entry);
        }
      }

      // Metadata — prefer RPE META, fall back to filename stem.
      let metadata: Metadata = metadataToStored(
        getBasename(chartEntry).split('.').slice(0, -1).join('.'),
      );
      try {
        const text = await chartEntry.file.text();
        const entry = readMetadataForChart(text, (JSON.parse(text) as RpeJson).META);
        metadata = {
          title: entry.name,
          composer: entry.composer,
          charter: entry.charter,
          illustrator: entry.illustration || null,
          level: entry.level,
          levelType: inferLevelType(entry.level),
          difficulty: null,
        };
      } catch {
        // Fallback metadata already set.
      }

      results.push({
        chart: {
          id: uuid(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata,
          resources: {
            chart: chartEntry.file,
            song: song?.file ?? new File([], ''),
            illustration: illustration?.file ?? new File([], ''),
          },
          assets: assetEntries.map((entry) => ({
            name: getBasename(entry),
            type: classifyFile(entry.file),
            file: entry.file,
            included: true,
          })),
        },
        unmatched: [],
      });
      assetEntries.forEach((entry) => assigned.add(entry));
      if (song) assigned.add(song);
      if (illustration) assigned.add(illustration);
      assigned.add(chartEntry);
      if (extra) assigned.add(extra);
    }
  }

  const unmatched = entries.filter((entry) => !assigned.has(entry));
  for (const result of results) {
    result.unmatched = unmatched;
  }
  return results;
}
