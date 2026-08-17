/**
 * Match local library entries against the online library so cards can show
 * public stats (e.g. download counts). Matching is by metadata (title,
 * composer, level type, level) — the API's list endpoints have no checksum
 * lookup yet. Results are cached per title for a short TTL; misses and
 * network failures are cached even shorter so a down API doesn't cause a
 * refetch storm on every library refresh.
 */

import { libraryApi, type ApiChartSummary, type ApiPackSummary } from './libraryApi';

export interface LocalChartLike {
  id: string;
  metadata: {
    title: string | null;
    composer: string | null;
    levelType: number;
    level: string | null;
  };
}

export interface LocalPackLike {
  id: string;
  name: string;
  author?: string;
}

const MATCH_TTL = 10 * 60 * 1000;
const MISS_TTL = 60 * 1000;

const norm = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase();

interface ChartCacheEntry {
  at: number;
  match: ApiChartSummary | null;
}
interface PackCacheEntry {
  at: number;
  match: ApiPackSummary | null;
}

const chartCache = new Map<string, ChartCacheEntry>();
const packCache = new Map<string, PackCacheEntry>();

/** Run `fn` over `items` with at most `limit` concurrent promises. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

export function matchesChart(candidate: ApiChartSummary, local: LocalChartLike): boolean {
  if (norm(candidate.title) !== norm(local.metadata.title)) return false;
  if (candidate.levelType !== local.metadata.levelType) return false;
  if (
    local.metadata.composer &&
    candidate.composer &&
    norm(candidate.composer) !== norm(local.metadata.composer)
  ) {
    return false;
  }
  if (
    local.metadata.level &&
    candidate.level &&
    norm(candidate.level) !== norm(local.metadata.level)
  ) {
    return false;
  }
  return true;
}

function matchesPack(candidate: ApiPackSummary, local: LocalPackLike): boolean {
  if (norm(candidate.name) !== norm(local.name)) return false;
  if (local.author && candidate.author && norm(candidate.author) !== norm(local.author)) {
    return false;
  }
  return true;
}

/** Resolve online charts for the given local chart summaries. */
export async function lookupChartStats(
  locals: LocalChartLike[],
): Promise<Map<string, ApiChartSummary>> {
  const found = new Map<string, ApiChartSummary>();
  const now = Date.now();
  const need: { key: string; local: LocalChartLike }[] = [];
  for (const local of locals) {
    const title = norm(local.metadata.title);
    if (!title) continue;
    const cached = chartCache.get(title);
    if (cached) {
      const ttl = cached.match ? MATCH_TTL : MISS_TTL;
      if (now - cached.at < ttl) {
        if (cached.match) found.set(local.id, cached.match);
        continue;
      }
    }
    need.push({ key: title, local });
  }
  await mapWithConcurrency(need, 6, async ({ key, local }) => {
    try {
      const response = await libraryApi.listCharts({
        q: local.metadata.title ?? key,
        pageSize: 5,
        sort: 'popular',
      });
      const match = response.items.find((candidate) => matchesChart(candidate, local)) ?? null;
      chartCache.set(key, { at: Date.now(), match });
      if (match) found.set(local.id, match);
    } catch {
      chartCache.set(key, { at: Date.now(), match: null });
    }
  });
  return found;
}

/** Resolve online resource packs for the given local packs. */
export async function lookupPacksStats(
  locals: LocalPackLike[],
): Promise<Map<string, ApiPackSummary>> {
  const found = new Map<string, ApiPackSummary>();
  const now = Date.now();
  const need: { key: string; local: LocalPackLike }[] = [];
  for (const local of locals) {
    const name = norm(local.name);
    if (!name) continue;
    const cached = packCache.get(name);
    if (cached) {
      const ttl = cached.match ? MATCH_TTL : MISS_TTL;
      if (now - cached.at < ttl) {
        if (cached.match) found.set(local.id, cached.match);
        continue;
      }
    }
    need.push({ key: name, local });
  }
  await mapWithConcurrency(need, 6, async ({ key, local }) => {
    try {
      const response = await libraryApi.listPacks({
        q: local.name ?? key,
        pageSize: 5,
        sort: 'popular',
      });
      const match = response.items.find((candidate) => matchesPack(candidate, local)) ?? null;
      packCache.set(key, { at: Date.now(), match });
      if (match) found.set(local.id, match);
    } catch {
      packCache.set(key, { at: Date.now(), match: null });
    }
  });
  return found;
}
