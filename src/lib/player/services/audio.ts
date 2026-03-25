import type { Sound, Timestamp } from '$lib/types';
import { IS_TAURI_LIKE } from '$lib/utils';
import { tauriInvoke } from '$lib/services/tauriIpc';

const IS_USABLE = IS_TAURI_LIKE;
export const mixAudio = async (
  sounds: Sound[],
  timestamps: Timestamp[],
  length: number,
  output: string,
) => {
  if (!IS_USABLE) return;
  return await tauriInvoke('mix_audio', {
    sounds,
    timestamps,
    length,
    output,
  });
};
