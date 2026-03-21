import * as env from '$env/static/public';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { base } from '$app/paths';

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

export const loadFFmpeg = async (core: Blob, wasm: Blob) => {
  const coreURL = URL.createObjectURL(core);
  const wasmURL = URL.createObjectURL(wasm);
  await ffmpeg.load({
    coreURL,
    wasmURL,
  });
  URL.revokeObjectURL(coreURL);
  URL.revokeObjectURL(wasmURL);
};

export const terminateFFmpeg = () => ffmpeg.terminate();

export const getFFmpeg = () => ffmpeg;
