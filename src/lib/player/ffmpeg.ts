import * as env from '$env/static/public';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { base } from '$app/paths';
import { invoke } from '@tauri-apps/api/tauri';

const ffmpeg = new FFmpeg();
const baseURL = 'PUBLIC_FFMPEG_URL' in env ? (env.PUBLIC_FFMPEG_URL as string) : `${base}/ffmpeg`;

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

export const setupFFmpeg = async (resolution: string, fps: number, codec: string) => {
  await invoke('setup_ffmpeg', { resolution, fps, codec });
};

export const sendFrame = async (frame: Uint8Array) => {
  await invoke('receive_frame', { frame });
};
