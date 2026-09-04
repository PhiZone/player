import * as env from '$env/static/public';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { base } from '$app/paths';
import { loadFFmpegBlob, saveFFmpegBlob } from '$lib/services/ffmpegStorage';
import { clamp } from '$lib/utils';
import { toyRootUrl } from '$lib/services/toyUrl';

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

export const getFFmpegURLs = () => ({
  core:
    'PUBLIC_FFMPEG_CORE_URL' in env && env.PUBLIC_FFMPEG_CORE_URL
      ? (env.PUBLIC_FFMPEG_CORE_URL as string)
      : `${rootFfmpegUrl()}/ffmpeg-core.js`,
  wasm:
    'PUBLIC_FFMPEG_WASM_URL' in env && env.PUBLIC_FFMPEG_WASM_URL
      ? (env.PUBLIC_FFMPEG_WASM_URL as string)
      : `${rootFfmpegUrl()}/ffmpeg-core.wasm`,
  isRemote:
    ('PUBLIC_FFMPEG_URL' in env && env.PUBLIC_FFMPEG_URL) ||
    ('PUBLIC_FFMPEG_CORE_URL' in env && env.PUBLIC_FFMPEG_CORE_URL) ||
    ('PUBLIC_FFMPEG_WASM_URL' in env && env.PUBLIC_FFMPEG_WASM_URL),
});

const ensureMimeType = (blob: Blob, mimeType: string): Blob =>
  blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });

const MAX_FETCH_ATTEMPTS = 3;
const FETCH_RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getContentLength = async (url: string): Promise<number> => {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) return -1;
    const length = parseInt(response.headers.get('content-length') ?? '-1', 10);
    if (length > 0) return length;
  } catch {
    // fall through to range probe
  }
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    });
    if (!response.ok) return -1;
    const range = response.headers.get('content-range');
    const length = range ? parseInt(range.split('/')[1] ?? '-1', 10) : -1;
    if (length > 0) return length;
    const contentLength = parseInt(response.headers.get('content-length') ?? '-1', 10);
    return contentLength > 0 ? contentLength : -1;
  } catch {
    return -1;
  }
};

const fetchBlob = async (
  url: string,
  expectedTotal: number,
  attempt = 0,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Blob> => {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    let total = parseInt(response.headers.get('content-length') ?? '-1', 10);
    if (!(total > 0)) total = expectedTotal;
    if (!response.body || !onProgress || !(total > 0)) {
      return await response.blob();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(Uint8Array.from(value));
        loaded += value.length;
        onProgress(loaded, total);
      }
    }
    return new Blob(chunks);
  } catch (error) {
    if (attempt >= MAX_FETCH_ATTEMPTS - 1) {
      throw new Error(`Failed to fetch ${url}: ${(error as Error).message}`);
    }
    await sleep(FETCH_RETRY_DELAY_MS * (attempt + 1));
    return fetchBlob(url, expectedTotal, attempt + 1, onProgress);
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
      const [coreTotal, wasmTotal] = await Promise.all([
        getContentLength(urls.core),
        getContentLength(urls.wasm),
      ]);
      const sizes: Record<string, number> = {
        [urls.core]: coreTotal,
        [urls.wasm]: wasmTotal,
      };
      const loaded: Record<string, number> = { [urls.core]: 0, [urls.wasm]: 0 };
      const report = (key: string, bytes: number, total: number) => {
        loaded[key] = bytes;
        if (total > 0) sizes[key] = total;
        if (!onProgress) return;
        const keys = [urls.core, urls.wasm];
        const known = keys.filter((k) => sizes[k] > 0);
        if (known.length === 0) return;
        const totalLoaded = known.reduce((sum, k) => sum + loaded[k], 0);
        const totalSize = known.reduce((sum, k) => sum + sizes[k], 0);
        onProgress(clamp(totalLoaded / totalSize, 0, 1));
      };
      [core, wasm] = await Promise.all([
        fetchBlob(urls.core, coreTotal, 0, (loadedBytes, total) =>
          report(urls.core, loadedBytes, total),
        ),
        fetchBlob(urls.wasm, wasmTotal, 0, (loadedBytes, total) =>
          report(urls.wasm, loadedBytes, total),
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
