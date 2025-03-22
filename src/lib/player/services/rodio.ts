import type { RodioSound, RodioTimestamp } from '$lib/types';
import { IS_TAURI } from '$lib/utils';
import { invoke } from '@tauri-apps/api/core';

const IS_USABLE = IS_TAURI;
export const mixAudio = async (
  musicFile: string,
  musicVolume: number,
  sounds: RodioSound[],
  timestamps: RodioTimestamp[],
  length: number,
  bitrate: string,
  videoFile: string,
  renderOutput: string,
) => {
  if (!IS_USABLE) return;
  return await invoke('mix_audio', { musicFile, musicVolume, sounds, timestamps, length, bitrate, videoFile, renderOutput });
};
