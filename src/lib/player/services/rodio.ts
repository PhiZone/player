import type { RodioSound, RodioTimestamp } from '$lib/types';
import { IS_TAURI } from '$lib/utils';
import { invoke } from '@tauri-apps/api/core';

const IS_USABLE = IS_TAURI;

export const mixAudio = async (
  sounds: RodioSound[],
  timestamps: RodioTimestamp[],
  length: number,
  output: string,
) => {
  if (!IS_USABLE) return;
  return await invoke('mix_audio', { sounds, timestamps, length, output });
};
