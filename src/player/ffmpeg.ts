import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { base } from '$app/paths';

const ffmpeg = new FFmpeg();

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
    coreURL: await toBlobURL(`${base}/ffmpeg/ffmpeg-core.js`, 'text/javascript', true, callback),
    wasmURL: await toBlobURL(`${base}/ffmpeg/ffmpeg-core.wasm`, 'application/wasm', true, callback),
  });
};

export const terminateFFmpeg = () => ffmpeg.terminate();

export const getFFmpeg = () => ffmpeg;
