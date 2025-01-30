import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { pathRoot } from './utils';

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
    coreURL: await toBlobURL(
      `${pathRoot()}ffmpeg/ffmpeg-core.js`,
      'text/javascript',
      true,
      callback,
    ),
    wasmURL: await toBlobURL(
      `${pathRoot()}ffmpeg/ffmpeg-core.wasm`,
      'application/wasm',
      true,
      callback,
    ),
  });
};

export const terminateFFmpeg = () => ffmpeg.terminate();

export const getFFmpeg = () => ffmpeg;
