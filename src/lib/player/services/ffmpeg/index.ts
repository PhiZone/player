import * as env from '$env/static/public';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { base } from '$app/paths';
import { loadFFmpegBlob, saveFFmpegBlob } from '$lib/services/ffmpegStorage';
import { clamp } from '$lib/utils';
import { toyRootUrl } from '$lib/services/toyUrl';
import { toyAssetUrl } from '$lib/player/toyAssetUrl';

const ffmpeg = new FFmpeg();

/**
 * Root for the platform-served ffmpeg files, evaluated lazily (the Toy
 * environment probe resolves well after module init, and this module is
 * first imported by the landing page at startup).
 *
 * Outside Toy, `base` is `''` (root-absolute paths) and `toyRootUrl` is a
 * pass-through. On Toy, the ffmpeg directory sits at the app root
 * (`/toy/<slug>/ffmpeg/`), while `$app/paths` `base` on the play page is
 * `/toy/<slug>/play` — joining `base` directly would 404 `play/ffmpeg/...`
 * every time the player needs to (re)convert audio. See `toyUrl.ts`.
 */
const rootFfmpegUrl = () => toyRootUrl(`${base}/ffmpeg`);
const ffmpegAssetUrl = (name: string) => toyAssetUrl(`${rootFfmpegUrl()}/${name}`);

export const getFFmpegURLs = () => ({
  core:
    'PUBLIC_FFMPEG_CORE_URL' in env && env.PUBLIC_FFMPEG_CORE_URL
      ? (env.PUBLIC_FFMPEG_CORE_URL as string)
      : ffmpegAssetUrl('ffmpeg-core.js'),
  wasm:
    'PUBLIC_FFMPEG_WASM_URL' in env && env.PUBLIC_FFMPEG_WASM_URL
      ? (env.PUBLIC_FFMPEG_WASM_URL as string)
      : ffmpegAssetUrl('ffmpeg-core.wasm'),
  isRemote:
    ('PUBLIC_FFMPEG_URL' in env && env.PUBLIC_FFMPEG_URL) ||
    ('PUBLIC_FFMPEG_CORE_URL' in env && env.PUBLIC_FFMPEG_CORE_URL) ||
    ('PUBLIC_FFMPEG_WASM_URL' in env && env.PUBLIC_FFMPEG_WASM_URL),
});

const ensureMimeType = (blob: Blob, mimeType: string): Blob =>
  blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });

const MAX_FETCH_ATTEMPTS = 3;
const FETCH_RETRY_DELAY_MS = 1000;
const FETCH_INACTIVITY_TIMEOUT_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type FetchProgress = (loaded: number, total: number, complete?: boolean) => void;

const fetchBlob = async (url: string, attempt = 0, onProgress?: FetchProgress): Promise<Blob> => {
  let controller: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const resetTimeout = () => {
    if (!controller) return;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, FETCH_INACTIVITY_TIMEOUT_MS);
  };
  try {
    controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    resetTimeout();
    const response = await fetch(url, {
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    });
    resetTimeout();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const total = parseInt(response.headers.get('content-length') ?? '-1', 10);
    if (!response.body || !onProgress) {
      onProgress?.(0, total);
      const blob = await response.blob();
      onProgress?.(blob.size, total > 0 ? total : blob.size, true);
      return blob;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let loaded = 0;
    onProgress(0, total);
    while (true) {
      const { done, value } = await reader.read();
      resetTimeout();
      if (done) break;
      if (value) {
        chunks.push(Uint8Array.from(value));
        loaded += value.length;
        onProgress(loaded, total);
      }
    }
    onProgress(loaded, total, true);
    return new Blob(chunks);
  } catch (error) {
    if (attempt >= MAX_FETCH_ATTEMPTS - 1) {
      const message = timedOut
        ? `timed out after ${FETCH_INACTIVITY_TIMEOUT_MS / 1000}s of inactivity`
        : error instanceof Error
          ? error.message
          : String(error);
      throw new Error(`Failed to fetch ${url}: ${message}`);
    }
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    await sleep(FETCH_RETRY_DELAY_MS * (attempt + 1));
    return fetchBlob(url, attempt + 1, onProgress);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const loadCachedFFmpegBlobs = async (): Promise<{ core: Blob; wasm: Blob } | null> => {
  try {
    // The cache key is the (app-root) URL of the file, so the play page and
    // the landing page share the same ffmpeg cache — the previous flat key
    // from the landing page never matches the play page's older attempts
    // that were written under a broken route-base URL.
    const [core, wasm] = await Promise.all([
      loadFFmpegBlob(getFFmpegURLs().core),
      loadFFmpegBlob(getFFmpegURLs().wasm),
    ]);
    if (core && wasm) return { core, wasm };
  } catch (e) {
    console.warn('Failed to load cached FFmpeg blobs:', e);
  }
  // Backward compatibility: older builds (non-Toy web, Tauri, Capacitor)
  // cached under the flat keys `ffmpeg-core.js` / `ffmpeg-core.wasm`. Reuse
  // those so a cache upgrade doesn't force a re-download of the 30 MB blob.
  try {
    const [core, wasm] = await Promise.all([
      loadFFmpegBlob('ffmpeg-core.js'),
      loadFFmpegBlob('ffmpeg-core.wasm'),
    ]);
    if (core && wasm) return { core, wasm };
  } catch (e) {
    console.warn('Failed to load legacy cached FFmpeg blobs:', e);
  }
  return null;
};

export const cacheFFmpegBlobs = async (core: Blob, wasm: Blob): Promise<void> => {
  try {
    await Promise.all([
      saveFFmpegBlob(getFFmpegURLs().core, core),
      saveFFmpegBlob(getFFmpegURLs().wasm, wasm),
    ]);
  } catch (e) {
    console.warn('Failed to cache FFmpeg blobs:', e);
  }
};

export const loadFFmpeg = async (
  core?: Blob,
  wasm?: Blob,
  onProgress?: (progress: number) => void,
) => {
  if (!core || !wasm) {
    const cached = await loadCachedFFmpegBlobs();
    if (cached) {
      core = cached.core;
      wasm = cached.wasm;
    } else {
      const urls = getFFmpegURLs();
      const sizes: Record<string, number> = {};
      const loaded: Record<string, number> = { [urls.core]: 0, [urls.wasm]: 0 };
      const completed: Record<string, boolean> = { [urls.core]: false, [urls.wasm]: false };
      const report = (key: string, bytes: number, total: number, done = false) => {
        loaded[key] = bytes;
        if (total > 0) sizes[key] = total;
        if (done) completed[key] = true;
        if (!onProgress) return;
        const keys = [urls.core, urls.wasm];
        const known = keys.filter((current) => sizes[current] > 0);
        if (known.length === keys.length) {
          const totalLoaded = known.reduce((sum, current) => sum + loaded[current], 0);
          const totalSize = known.reduce((sum, current) => sum + sizes[current], 0);
          onProgress(clamp(totalLoaded / totalSize, 0, 1));
          return;
        }
        const progress =
          keys.reduce((sum, current) => {
            if (sizes[current] > 0) {
              return sum + clamp(loaded[current] / sizes[current], 0, 1);
            }
            return sum + (completed[current] ? 1 : loaded[current] > 0 ? 0.05 : 0.01);
          }, 0) / keys.length;
        onProgress(clamp(progress, 0, 1));
      };
      [core, wasm] = await Promise.all([
        fetchBlob(urls.core, 0, (loadedBytes, total, done) =>
          report(urls.core, loadedBytes, total, done),
        ),
        fetchBlob(urls.wasm, 0, (loadedBytes, total, done) =>
          report(urls.wasm, loadedBytes, total, done),
        ),
      ]);
      await cacheFFmpegBlobs(core, wasm);
    }
  } else {
    await cacheFFmpegBlobs(core, wasm);
  }
  const coreURL = URL.createObjectURL(ensureMimeType(core, 'text/javascript'));
  const wasmURL = URL.createObjectURL(ensureMimeType(wasm, 'application/wasm'));
  await ffmpeg.load({
    coreURL,
    wasmURL,
  });
  URL.revokeObjectURL(coreURL);
  URL.revokeObjectURL(wasmURL);
};

export const terminateFFmpeg = () => ffmpeg.terminate();

export const getFFmpeg = () => ffmpeg;
