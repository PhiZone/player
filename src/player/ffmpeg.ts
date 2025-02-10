import { PUBLIC_FFMPEG_URL } from '$env/static/public';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { base } from '$app/paths';

const ffmpeg = new FFmpeg();
const baseURL = PUBLIC_FFMPEG_URL ?? `${base}/ffmpeg`;

export const loadFFmpeg = async (
  callback?: ({
    url,
    received,
    total,
  }: {
    url: string | URL;
    received: number;
    total: number;
  }) => void,
) => {
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript', true, callback),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm', true, callback),
  });
};

export const terminateFFmpeg = () => ffmpeg.terminate();

export const getFFmpeg = () => ffmpeg;
