import type { RodioSound, RodioTimestamp } from '$lib/types';
import { IS_TAURI } from '$lib/utils';
import { invoke } from '@tauri-apps/api/core';

const IS_USABLE = IS_TAURI;

export const mixAudio = async (
  sounds: RodioSound[],
  timestamps: RodioTimestamp[],
  output: string,
) => {
  if (!IS_USABLE) return;
  console.log(sounds, timestamps, output);
  return await invoke('mix_audio', { sounds, timestamps, output });
};
