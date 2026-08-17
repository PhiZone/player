/**
 * Bilibili Toy SDK integration (https://www.bilibili.com/toy/).
 *
 * The Toy JS SDK (v1.6.0) is an official bridge between a Toy page and the
 * Bilibili App/Web environment. The SDK script is never loaded on the normal
 * website — it is injected lazily only when the page looks like a Toy page
 * (`https://*.bilibili.com/toy/<slug>/...`), and `window.toy` presence plus
 * an `isSupport` probe is then the environment signal.
 *
 * SDK constraints relevant here:
 * - Leaderboards are scoped per (toy + board + period); `board` is fixed to
 *   1/2/3 and there is no per-chart dimension. The basic integration uses a
 *   single board (1) as "the chart leaderboard" — a Toy deployment is
 *   expected to host a single chart (authors publish one toy per chart).
 * - The first `getUserProfile()` call must be triggered by a user gesture
 *   unless a valid v1/v2 profile grant is already cached by the platform.
 * - Cloud storage is per (logged-in user + toy) and is used here only to
 *   persist the personal-best accuracy next to the official score (the SDK
 *   leaderboard has no accuracy field).
 * - Scores are integers in [-16777216, 16777215]; Phigros scores
 *   (0..1,000,000) fit. Display is zero-padded to 7 digits.
 */

export type ToyBoard = 1 | 2 | 3;
export type ToyRankPeriod = 'all' | 'month' | 'week' | 'day';

export interface ToyUserProfile {
  avatar: string;
  nickname: string;
  /** Stable pseudonymous id, scoped to this toy. Never log or track it. */
  toyOpenId?: string;
}

export interface ToyRankItem {
  rank: number;
  score: number;
  nickname: string;
  avatar: string;
}

export interface ToyMyRank {
  ranked: boolean;
  rank: number;
  score: number;
}

export interface ToyPersonalBest {
  score: number;
  accuracy: number;
  updatedAt: number;
}

interface ToySdk {
  isSupport(ability: string): Promise<boolean>;
  getUserProfile(): Promise<ToyUserProfile>;
  getRankList(req?: {
    board?: ToyBoard;
    period?: ToyRankPeriod;
    limit?: number;
  }): Promise<ToyRankItem[]>;
  getMyRank(req?: { board?: ToyBoard; period?: ToyRankPeriod }): Promise<ToyMyRank>;
  submitScore(req: { board?: ToyBoard; score: number }): Promise<{ score: number }>;
  getCloudStorage(keys?: string[]): Promise<Record<string, string>>;
  setCloudStorage(items: Record<string, string>): Promise<void>;
}

declare global {
  interface Window {
    toy?: ToySdk;
  }
}

/** The single leaderboard board used for charts (see module docs). */
export const TOY_SCORE_BOARD: ToyBoard = 1;

const SDK_URL = '//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js';
const PB_PREFIX = 'pbacc_';
const TOY_SCORE_MIN = -16777216;
const TOY_SCORE_MAX = 16777215;

let toyEnvPromise: Promise<boolean> | undefined;

function looksLikeToyPage(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, pathname } = window.location;
  return hostname.endsWith('bilibili.com') && pathname.startsWith('/toy/');
}

function injectSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('[ToySDK] failed to load toy-sdk.js'));
    document.head.appendChild(script);
  });
}

/** True once `window.toy` is present (script loaded). */
export function isToyEnvironment(): boolean {
  return typeof window !== 'undefined' && !!window.toy;
}

/**
 * Detect the Toy environment. Result is cached for the session. Never loads
 * the SDK script outside of Toy pages.
 */
export function detectToyEnvironment(): Promise<boolean> {
  toyEnvPromise ??= (async () => {
    try {
      if (isToyEnvironment()) return true;
      if (!looksLikeToyPage()) return false;
      await injectSdkScript();
      if (!isToyEnvironment()) return false;
      return await window.toy!.isSupport('getUserProfile').catch(() => false);
    } catch {
      return false;
    }
  })();
  return toyEnvPromise;
}

/** Zero-pad a score to 7 digits (Phigros convention, e.g. 0012345). */
export const padToyScore = (score: number): string =>
  String(Math.max(0, Math.min(TOY_SCORE_MAX, Math.round(score)))).padStart(7, '0');

const sanitizeKey = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, '');

/** Ask the platform for the current user's profile (consent dialog on first
 * grant). Returns null when unavailable or rejected (e.g. outside a gesture). */
export async function toyGetUserProfile(): Promise<ToyUserProfile | null> {
  if (!(await detectToyEnvironment())) return null;
  try {
    return await window.toy!.getUserProfile();
  } catch (error) {
    console.debug('[ToySDK] getUserProfile failed:', error);
    return null;
  }
}

/** Read a chart leaderboard (guest-readable). Null on failure. */
export async function toyGetRankList(
  board: ToyBoard = TOY_SCORE_BOARD,
  limit = 20,
): Promise<ToyRankItem[] | null> {
  if (!(await detectToyEnvironment())) return null;
  try {
    return await window.toy!.getRankList({ board, period: 'all', limit });
  } catch (error) {
    console.debug('[ToySDK] getRankList failed:', error);
    return null;
  }
}

/** Read the current user's rank on a chart leaderboard (login required). */
export async function toyGetMyRank(board: ToyBoard = TOY_SCORE_BOARD): Promise<ToyMyRank | null> {
  if (!(await detectToyEnvironment())) return null;
  try {
    return await window.toy!.getMyRank({ board, period: 'all' });
  } catch (error) {
    console.debug('[ToySDK] getMyRank failed:', error);
    return null;
  }
}

/** Submit an absolute score to a chart leaderboard board. */
export async function toySubmitScore(
  board: ToyBoard = TOY_SCORE_BOARD,
  score: number,
): Promise<boolean> {
  if (!(await detectToyEnvironment())) return false;
  const clamped = Math.min(TOY_SCORE_MAX, Math.max(TOY_SCORE_MIN, Math.round(score)));
  try {
    await window.toy!.submitScore({ board, score: clamped });
    return true;
  } catch (error) {
    console.debug('[ToySDK] submitScore failed:', error);
    return false;
  }
}

/** Read the stored personal best for a chart (score + accuracy). */
export async function toyGetPersonalBest(chartKey: string): Promise<ToyPersonalBest | null> {
  if (!(await detectToyEnvironment())) return null;
  try {
    const key = PB_PREFIX + sanitizeKey(chartKey);
    const data = await window.toy!.getCloudStorage([key]);
    const raw = data[key];
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ToyPersonalBest;
    return typeof parsed.score === 'number' && typeof parsed.accuracy === 'number' ? parsed : null;
  } catch (error) {
    console.debug('[ToySDK] getCloudStorage failed:', error);
    return null;
  }
}

/** Persist the personal best (score + accuracy) for a chart; keeps the best. */
export async function toySavePersonalBest(
  chartKey: string,
  score: number,
  accuracy: number,
): Promise<void> {
  if (!(await detectToyEnvironment())) return;
  try {
    const key = PB_PREFIX + sanitizeKey(chartKey);
    const data = await window.toy!.getCloudStorage([key]);
    const previous = data[key] ? (JSON.parse(data[key]) as ToyPersonalBest) : null;
    if (previous && previous.score >= score) return;
    await window.toy!.setCloudStorage({
      [key]: JSON.stringify({ score, accuracy, updatedAt: Date.now() }),
    });
  } catch (error) {
    console.debug('[ToySDK] setCloudStorage failed:', error);
  }
}
