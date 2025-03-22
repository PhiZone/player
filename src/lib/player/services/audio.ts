import type { Sound, Timestamp } from '$lib/types';
import { IS_TAURI } from '$lib/utils';
import { invoke } from '@tauri-apps/api/core';

const IS_USABLE = IS_TAURI;
export const mixAudio = async (
  sounds: Sound[],
  timestamps: Timestamp[],
  length: number,
  output: string,
) => {
  if (!IS_USABLE) return;
  return await invoke('mix_audio', {
    sounds,
    timestamps,
    length,
    output,
  });
};
