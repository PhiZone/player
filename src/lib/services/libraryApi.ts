/**
 * Typed client for the PhiZone Player library API (https://player-api.phi.zone).
 *
 * Public read endpoints only — no auth, no user concept; every item is
 * publicly available content. Types mirror the API's OpenAPI schemas
 * (see `schemas.ts` in the player-api-preview repository). Point the app at
 * a different instance with the `PUBLIC_API_BASE_URL` environment variable.
 */

export type ApiLevelType = 0 | 1 | 2 | 3 | 4;

export interface ApiCover {
  name: string;
  size: number;
  url: string;
}

export interface ApiFileIdentity {
  name: string;
  size: number;
  checksum: string;
  mimeType: string;
}

export interface ApiChartSummary {
  id: string;
  title: string;
  composer: string | null;
  charter: string | null;
  illustrator: string | null;
  levelType: ApiLevelType;
  level: string | null;
  difficulty: number | null;
  format: string | null;
  cover: ApiCover | null;
  downloadCount: number;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiChartDetail extends ApiChartSummary {
  description: string | null;
  sourceName: string | null;
  file: ApiFileIdentity;
  fileUrl: string;
}

export interface ApiPackSummary {
  id: string;
  name: string;
  author: string;
  version: string | null;
  cover: ApiCover | null;
  downloadCount: number;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiPackDetail extends ApiPackSummary {
  description: string | null;
  sourceName: string | null;
  file: ApiFileIdentity;
  fileUrl: string;
}

export interface ApiListResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type ApiSort = 'newest' | 'oldest' | 'popular' | 'title';

export interface ApiListQuery {
  page?: number;
  pageSize?: number;
  sort?: ApiSort;
  q?: string;
}

const API_BASE: string =
  (import.meta.env.PUBLIC_API_BASE_URL as string | undefined) ?? 'https://player-api.phi.zone';

const toQuery = (query: ApiListQuery): string => {
  const qs = new URLSearchParams();
  if (query.page !== undefined) qs.set('page', String(query.page));
  if (query.pageSize !== undefined) qs.set('pageSize', String(query.pageSize));
  if (query.sort !== undefined) qs.set('sort', query.sort);
  if (query.q !== undefined && query.q !== '') qs.set('q', query.q);
  return qs.toString();
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await withTimeout(fetch(`${API_BASE}${path}`), 15000);
  } catch (error) {
    throw new Error(`Cannot reach the library API at ${API_BASE}.`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Library API error ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

export const libraryApi = {
  baseUrl: API_BASE,
  listCharts: (query: ApiListQuery = {}) =>
    getJson<ApiListResponse<ApiChartSummary>>(`/charts?${toQuery(query)}`),
  getChart: (id: string) => getJson<ApiChartDetail>(`/charts/${encodeURIComponent(id)}`),
  listPacks: (query: ApiListQuery = {}) =>
    getJson<ApiListResponse<ApiPackSummary>>(`/packs?${toQuery(query)}`),
  getPack: (id: string) => getJson<ApiPackDetail>(`/packs/${encodeURIComponent(id)}`),
};
