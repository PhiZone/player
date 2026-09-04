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
  removeCloudStorage(keys: string[]): Promise<void>;
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

// ── Durable settings via Toy cloud storage ────────────────────────────
// iOS Safari does not persist localStorage/IndexedDB for the cross-origin
// sandboxed iframe that hosts Toy pages (it works on Windows/Chrome and in a
// normal iPad tab, but is wiped on every reload inside the Toy iframe on
// iPad). The Toy SDK's cloud storage is the only durable store available
// there.
//
// Cloud storage constraints (per the SDK docs): keys are
// `[a-zA-Z0-9_-]{1,128}` (a `__` prefix is reserved), values are strings
// ≤1024 bytes, and the store is capped at 128 keys per (user + toy). That
// rules out persisting chart/respack/ffmpeg blobs (MBs each) — those stay
// session-only on Toy. We use cloud storage only for the small settings
// JSON (preferences/toggles/mediaOptions/selected respack/last tab), which
// fits comfortably and is what users expect to survive a reload.
const CLOUD_PREFIX = 'app_'; // namespaced under the reserved-safe prefix
const CLOUD_VALUE_MAX = 1024; // SDK hard limit

/** True once the Toy cloud-storage ability is confirmed available. */
let cloudStorageReady = false;

/** Probe whether durable cloud storage is usable in this environment. */
export async function toyCloudStorageAvailable(): Promise<boolean> {
  if (!(await detectToyEnvironment())) return false;
  if (cloudStorageReady) return true;
  try {
    await window.toy!.getCloudStorage([]);
    cloudStorageReady = true;
  } catch {
    cloudStorageReady = false;
  }
  return cloudStorageReady;
}

const cloudKey = (key: string) => CLOUD_PREFIX + sanitizeKey(key);

/** Read a durable value from Toy cloud storage. Null when absent/unavailable. */
export async function toyCloudGet(key: string): Promise<string | null> {
  if (!(await toyCloudStorageAvailable())) return null;
  try {
    const data = await window.toy!.getCloudStorage([cloudKey(key)]);
    return data[cloudKey(key)] ?? null;
  } catch (error) {
    console.debug('[ToySDK] getCloudStorage failed:', error);
    return null;
  }
}

/** Write a durable value to Toy cloud storage. Returns false on failure. */
export async function toyCloudSet(key: string, value: string): Promise<boolean> {
  if (!(await toyCloudStorageAvailable())) return false;
  if (value.length > CLOUD_VALUE_MAX) return false;
  try {
    await window.toy!.setCloudStorage({ [cloudKey(key)]: value });
    return true;
  } catch (error) {
    console.debug('[ToySDK] setCloudStorage failed:', error);
    return false;
  }
}

/** Remove a durable value from Toy cloud storage. */
export async function toyCloudRemove(key: string): Promise<void> {
  if (!(await toyCloudStorageAvailable())) return;
  try {
    await window.toy!.removeCloudStorage([cloudKey(key)]);
  } catch (error) {
    console.debug('[ToySDK] removeCloudStorage failed:', error);
  }
}

/** Zero-pad a score to 7 digits (Phigros convention, e.g. 0012345). */
export const padToyScore = (score: number): string =>
  String(Math.max(0, Math.min(TOY_SCORE_MAX, Math.round(score)))).padStart(7, '0');

// Synchronous mirror of the Toy-environment detection, driven by the official
// `isSupport` probe once it resolves. Synchronous call sites (asset URL
// rewriting, full-page navigation URL rewriting) read this instead of
// guessing from the hostname/pathname. It is `false` until the first
// `detectToyEnvironment()` resolves, so those call sites only rewrite after
// the SDK confirmed the environment.
let toyEnvSync = false;

/** True once the SDK's `isSupport` probe confirmed a Toy environment. */
export function isToyEnvironmentSync(): boolean {
  return toyEnvSync;
}

function looksLikeToyPage(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, pathname } = window.location;
  return (
    (hostname.endsWith('bilibili.com') || hostname.endsWith('bilibilitoy.com')) &&
    pathname.startsWith('/toy/')
  );
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
 * Detect the Toy environment using the official `toy.isSupport` probe.
 * Result is cached for the session, and the synchronous mirror
 * (`isToyEnvironmentSync`) is set once the probe confirms. Never loads the
 * SDK script outside of Toy pages.
 */
export function detectToyEnvironment(): Promise<boolean> {
  toyEnvPromise ??= (async () => {
    try {
      if (isToyEnvironment()) {
        const ok = await window.toy!.isSupport('getUserProfile').catch(() => false);
        toyEnvSync = ok;
        return ok;
      }
      if (!looksLikeToyPage()) return false;
      await injectSdkScript();
      if (!isToyEnvironment()) return false;
      const ok = await window.toy!.isSupport('getUserProfile').catch(() => false);
      toyEnvSync = ok;
      return ok;
    } catch {
      return false;
    }
  })();
  return toyEnvPromise;
}

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

/**
 * Remove the stored personal best for a chart from Toy cloud storage. Called
 * when a chart is deleted so orphaned per-chart data doesn't accumulate
 * (cloud storage is scoped per toy and capped at 128 keys).
 */
export async function toyClearPersonalBest(chartKey: string): Promise<void> {
  if (!(await detectToyEnvironment())) return;
  try {
    const key = PB_PREFIX + sanitizeKey(chartKey);
    await window.toy!.removeCloudStorage([key]);
  } catch (error) {
    console.debug('[ToySDK] removeCloudStorage failed:', error);
  }
}
