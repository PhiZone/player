import { IS_TAURI } from '$lib/utils';
import { invoke } from '@tauri-apps/api/core';

const USABLE = IS_TAURI;
let frameStreaming = false;

export const pngToVideo = async (
  input: string,
  output: string,
  resolution: [number, number],
  frameRate: number,
  codec: string,
) => {
  if (!USABLE) return;
  return await invoke('ffmpeg_png_sequence_to_video', {
    input,
    output,
    resolution: `${resolution[0]}x${resolution[1]}`,
    fps: frameRate,
    codec,
  });
};

export const setupVideo = async (
  resolution: [number, number],
  frameRate: number,
  codec: string,
) => {
  if (!USABLE) return;
  frameStreaming = true;
  return await invoke('setup_ffmpeg_video', {
    resolution: `${resolution[0]}x${resolution[1]}`,
    fps: frameRate,
    codec,
  });
};

export const renderFrame = async (frame: Uint8Array) => {
  if (!USABLE || !frameStreaming) return;
  return await invoke('render_frame', { frame });
};

export const finishVideo = async () => {
  if (!USABLE) return;
  frameStreaming = false;
  return await invoke('finish_ffmpeg_video');
};

export const isFrameStreaming = () => frameStreaming;
