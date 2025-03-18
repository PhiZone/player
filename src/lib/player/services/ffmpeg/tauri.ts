import type { FFmpegEncoder } from '$lib/types';
import { IS_TAURI } from '$lib/utils';
import { invoke } from '@tauri-apps/api/core';

let isUsable = IS_TAURI;
let frameStreaming = false;

export const getEncoders = async () => {
  if (!isUsable) return;
  try {
    return (await invoke('get_ffmpeg_encoders')) as FFmpegEncoder[];
  } catch (e) {
    console.error(e);
    isUsable = false;
  }
};

export const pngToVideo = async (
  input: string,
  output: string,
  resolution: [number, number],
  frameRate: number,
  codec: string,
) => {
  if (!isUsable) return;
  return await invoke('ffmpeg_png_sequence_to_video', {
    input,
    output,
    resolution: `${resolution[0]}x${resolution[1]}`,
    fps: frameRate,
    codec,
  });
};

export const setupVideo = async (
  output: string,
  resolution: [number, number],
  framerate: number,
  codec: string,
  bitrate: number,
) => {
  if (!isUsable) return;
  frameStreaming = true;
  return await invoke('setup_ffmpeg_video', {
    output,
    resolution: `${resolution[0]}x${resolution[1]}`,
    framerate,
    codec,
    bitrate: `${bitrate}k`,
  });
};

export const finishVideo = async () => {
  if (!isUsable) return;
  frameStreaming = false;
  return await invoke('finish_ffmpeg_video');
};

export const isFrameStreaming = () => frameStreaming;
