import type { FFmpegEncoder } from '$lib/types';
import { IS_TAURI, IS_TAURI_LIKE } from '$lib/utils';
import { tauriInvoke } from '$lib/services/tauriIpc';

let frameStreaming = false;

export const getFFmpegDownloadLink = async () => {
  // FFmpeg download only makes sense in native Tauri where we need the binary locally
  if (!IS_TAURI) return null;
  const { platform, arch } = await import('@tauri-apps/plugin-os');
  const p = platform();
  const a = arch();
  if (!['windows', 'linux', 'macos'].includes(p) || !['x86_64', 'aarch64'].includes(a)) {
    return null;
  }
  const isWindows = p === 'windows';
  const isX86 = a.startsWith('x86');
  if (isWindows && !isX86) {
    return null;
  }
  const distribution = (isWindows ? 'win32-x64' : isX86 ? `${p}-x64` : `${p}-arm64`).replace(
    'macos',
    'darwin',
  );
  return `https://registry.npmmirror.com/@ffmpeg-binary/${distribution}/-/${distribution}-7.0.0.tgz`;
};

export const setFFmpegPath = async (path: string) => {
  if (!IS_TAURI_LIKE) return;
  try {
    await tauriInvoke('set_ffmpeg_path', { path });
    localStorage.setItem('ffmpegPath', path);
  } catch (e) {
    console.error(e);
  }
};

export const getEncoders = async () => {
  if (!IS_TAURI_LIKE) return;
  const doGetEncoders = async () => {
    return (await tauriInvoke('get_ffmpeg_encoders')) as FFmpegEncoder[];
  };
  try {
    return await doGetEncoders();
  } catch (e) {
    console.debug('Unable to find FFmpeg in PATH', e);
    try {
      const path = localStorage.getItem('ffmpegPath');
      if (path) {
        await setFFmpegPath(path);
        return await doGetEncoders();
      }
    } catch (e) {
      console.debug('Unable to find FFmpeg in self-managed path', e);
    }
  }
};

export const convertAudio = async (input: string, output: string) => {
  if (!IS_TAURI_LIKE) return;
  return await tauriInvoke('convert_audio', { input, output });
};

export const setupVideo = async (
  output: string,
  resolution: [number, number],
  frameRate: number,
  duration: number,
  codec: string,
  bitrate: number,
) => {
  if (!IS_TAURI_LIKE) return;
  frameStreaming = true;
  return await tauriInvoke('setup_video', {
    output,
    resolution: `${resolution[0]}x${resolution[1]}`,
    frameRate,
    duration,
    codec,
    bitrate: `${bitrate}k`,
  });
};

export const finishVideo = async () => {
  if (!IS_TAURI_LIKE) return;
  frameStreaming = false;
  return await tauriInvoke('finish_video');
};

export const combineStreams = async (
  inputVideo: string,
  inputMusic: string,
  inputHitsounds: string,
  musicVolume: number,
  audioBitrate: number,
  output: string,
) => {
  if (!IS_TAURI_LIKE) return;
  return await tauriInvoke('combine_streams', {
    inputVideo,
    inputMusic,
    inputHitsounds,
    musicVolume,
    audioBitrate: `${audioBitrate}k`,
    output,
  });
};

export const isFrameStreaming = () => frameStreaming;
