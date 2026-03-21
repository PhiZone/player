import * as env from '$env/static/public';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { base } from '$app/paths';
import { loadFFmpegBlob, saveFFmpegBlob } from '$lib/services/ffmpegStorage';

const ffmpeg = new FFmpeg();
const baseURL =
  'PUBLIC_FFMPEG_URL' in env && env.PUBLIC_FFMPEG_URL
    ? (env.PUBLIC_FFMPEG_URL as string)
    : `${base}/ffmpeg`;

export const getFFmpegURLs = () => ({
  core:
    'PUBLIC_FFMPEG_CORE_URL' in env && env.PUBLIC_FFMPEG_CORE_URL
      ? (env.PUBLIC_FFMPEG_CORE_URL as string)
      : `${baseURL}/ffmpeg-core.js`,
  wasm:
    'PUBLIC_FFMPEG_WASM_URL' in env && env.PUBLIC_FFMPEG_WASM_URL
      ? (env.PUBLIC_FFMPEG_WASM_URL as string)
      : `${baseURL}/ffmpeg-core.wasm`,
  isRemote:
    ('PUBLIC_FFMPEG_URL' in env && env.PUBLIC_FFMPEG_URL) ||
    ('PUBLIC_FFMPEG_CORE_URL' in env && env.PUBLIC_FFMPEG_CORE_URL) ||
    ('PUBLIC_FFMPEG_WASM_URL' in env && env.PUBLIC_FFMPEG_WASM_URL),
});

const ensureMimeType = (blob: Blob, mimeType: string): Blob =>
  blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });

const fetchBlob = async (url: string): Promise<Blob> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  return await response.blob();
};

export const loadCachedFFmpegBlobs = async (): Promise<{ core: Blob; wasm: Blob } | null> => {
  try {
    const [core, wasm] = await Promise.all([
      loadFFmpegBlob('ffmpeg-core.js'),
      loadFFmpegBlob('ffmpeg-core.wasm'),
    ]);
    if (core && wasm) return { core, wasm };
  } catch (e) {
    console.warn('Failed to load cached FFmpeg blobs:', e);
  }
  return null;
};

export const cacheFFmpegBlobs = async (core: Blob, wasm: Blob): Promise<void> => {
  try {
    await Promise.all([
      saveFFmpegBlob('ffmpeg-core.js', core),
      saveFFmpegBlob('ffmpeg-core.wasm', wasm),
    ]);
  } catch (e) {
    console.warn('Failed to cache FFmpeg blobs:', e);
  }
};

export const loadFFmpeg = async (core?: Blob, wasm?: Blob) => {
  if (!core || !wasm) {
    const cached = await loadCachedFFmpegBlobs();
    if (cached) {
      core = cached.core;
      wasm = cached.wasm;
    } else {
      const urls = getFFmpegURLs();
      [core, wasm] = await Promise.all([fetchBlob(urls.core), fetchBlob(urls.wasm)]);
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
