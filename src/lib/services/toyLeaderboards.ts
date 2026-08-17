/**
 * Chart leaderboard mapping for the bilibili Toy environment.
 *
 * The Toy SDK leaderboards are scoped per (toy + board + period); `board` is
 * fixed to 1/2/3 and there is no per-chart dimension. The convention here:
 * the **first three online charts by creation date** own the toy's three
 * boards — board 1 = oldest chart, board 2 = second oldest, board 3 = third
 * oldest. Ordering by creation date keeps the set stable (new charts never
 * displace the leaderboard charts), and each leaderboard chart is matched to
 * local charts by metadata (same matcher as `onlineStats`).
 */

import { libraryApi, type ApiChartSummary } from './libraryApi';
import { detectToyEnvironment, toySavePersonalBest, toySubmitScore, type ToyBoard } from './toy';
import { matchesChart, type LocalChartLike } from './onlineStats';

export interface LeaderboardChart {
  /** The toy leaderboard board this chart owns (1 = oldest). */
  board: ToyBoard;
  chart: ApiChartSummary;
}

export interface ToyPlayMode {
  autoplay?: boolean;
  practice?: boolean;
  render?: boolean;
}

const SET_TTL = 5 * 60 * 1000;
const SET_SIZE = 3;

let cachedSet: { at: number; charts: LeaderboardChart[] } | null = null;

/**
 * The charts that own the toy's leaderboard boards: the first `SET_SIZE`
 * online charts sorted by creation date. Empty outside the Toy environment
 * or when the library API is unreachable (then the last known set is kept).
 */
export async function getLeaderboardCharts(force = false): Promise<LeaderboardChart[]> {
  if (!(await detectToyEnvironment())) return [];
  const now = Date.now();
  if (!force && cachedSet && now - cachedSet.at < SET_TTL) return cachedSet.charts;
  try {
    const response = await libraryApi.listCharts({ sort: 'oldest', pageSize: SET_SIZE });
    const charts = response.items.map((chart, i) => ({
      board: (i + 1) as ToyBoard,
      chart,
    }));
    cachedSet = { at: now, charts };
    return charts;
  } catch {
    return cachedSet?.charts ?? [];
  }
}

/** Whether an online chart id owns one of the toy's leaderboard boards. */
export async function findLeaderboardBoardById(id: string): Promise<ToyBoard | null> {
  const charts = await getLeaderboardCharts();
  return charts.find(({ chart }) => chart.id === id)?.board ?? null;
}

/** Resolve the leaderboard board for a (local) chart by metadata match. */
export async function findChartBoard(
  metadata: LocalChartLike['metadata'],
): Promise<ToyBoard | null> {
  const charts = await getLeaderboardCharts();
  if (charts.length === 0) return null;
  return charts.find(({ chart }) => matchesChart(chart, { id: '', metadata }))?.board ?? null;
}

/**
 * Report a finished play to the chart's Toy leaderboard board and persist
 * the personal-best accuracy. Charts without a leaderboard board (not among
 * the first three online charts) are ignored, as are autoplay / practice /
 * render runs (not real performances). `accuracy` is a 0..1 ratio.
 */
export async function submitToyChartScore(
  chartKey: string | undefined,
  metadata: LocalChartLike['metadata'],
  score: number,
  accuracy: number,
  mode: ToyPlayMode = {},
): Promise<void> {
  if (!chartKey) return;
  if (mode.autoplay || mode.practice || mode.render) return;
  const board = await findChartBoard(metadata);
  if (board === null) return;
  await toySubmitScore(board, score);
  await toySavePersonalBest(chartKey, Math.round(score), Math.round(accuracy * 10000) / 100);
}
