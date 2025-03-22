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

export const convertAudio = async (input: string, output: string) => {
  if (!isUsable) return;
  return await invoke('convert_audio', { input, output });
};

export const composeAudio = async (
  hitsounds: string,
  music: string,
  musicVolume: number,
  bitrate: number,
  output: string,
) => {
  if (!isUsable) return;
  return await invoke('compose_audio', {
    hitsounds,
    music,
    volume: musicVolume,
    bitrate: `${bitrate}k`,
    output,
  });
};

export const setupVideo = async (
  output: string,
  resolution: [number, number],
  frameRate: number,
  codec: string,
  bitrate: number,
) => {
  if (!isUsable) return;
  frameStreaming = true;
  return await invoke('setup_video', {
    output,
    resolution: `${resolution[0]}x${resolution[1]}`,
    frameRate,
    codec,
    bitrate: `${bitrate}k`,
  });
};

export const finishVideo = async () => {
  if (!isUsable) return;
  frameStreaming = false;
  return await invoke('finish_video');
};

export const combineStreams = async (inputVideo: string, inputAudio: string, output: string) => {
  if (!isUsable) return;
  return await invoke('combine_streams', { inputVideo, inputAudio, output });
};

export const isFrameStreaming = () => frameStreaming;
