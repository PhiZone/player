import { page } from '$app/state';
import {
  type Config,
  type LevelType,
  type MetadataEntry,
  type OutgoingMessage,
  type PhiraResourcePack,
  type ResourcePack,
  type ResourcePackWithId,
  type RpeMeta,
  type StoredChart,
} from './types';
import { AndroidFullScreen } from '@awesome-cordova-plugins/android-full-screen';
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import Notiflix from 'notiflix';
import mime from 'mime/lite';
import JSZip from 'jszip';
import * as YAML from 'yaml';
import { ungzip } from 'pako';
import { fileTypeFromBlob } from 'file-type';
import { DEFAULT_RESOURCE_PACK } from './player/constants';
import { m } from './paraglide/messages';
import { tauriInvoke } from './services/tauriIpc';

export const IS_TAURI = '__TAURI_INTERNALS__' in window;

/**
 * True when running inside Tauri **or** when the `backend` query param is
 * present, meaning we're in a browser that should proxy IPC calls to a
 * running Tauri backend via WebSocket.
 */
export const IS_TAURI_LIKE: boolean = (() => {
  if (IS_TAURI) return true;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('backend');
})();

/**
 * True when running in a browser (not native Tauri) with the `backend`
 * query param, i.e. proxying to the Tauri backend over WebSocket.
 */
export const IS_BROWSER_WITH_BACKEND = IS_TAURI_LIKE && !IS_TAURI;

export const IS_IOS = (() => {
  const iosQuirkPresent = () => {
    const audio = new Audio();
    audio.volume = 0.5;
    return audio.volume === 1; // volume cannot be changed from "1" on iOS 12 and below
  };

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAppleDevice = navigator.userAgent.includes('Macintosh');
  const isTouchScreen = navigator.maxTouchPoints >= 1; // true for iOS 13 (and hopefully beyond)

  return isIOS || (isAppleDevice && (isTouchScreen || iosQuirkPresent()));
})();

export const IS_ANDROID_OR_IOS =
  IS_IOS ||
  (() => {
    if (/windows phone/i.test(navigator.userAgent)) {
      return false;
    }
    if (/android/i.test(navigator.userAgent)) {
      return true;
    }
    return false;
  })();

export const IS_IFRAME = window.self !== window.top;

export const isDebug = () => checkIfEnabled('debug');

export const showPerformance = () => checkIfEnabled('performance');

export const checkIfEnabled = (key: string) =>
  ['1', 'true'].some(
    (v) => v === page.url.searchParams.get(key) || v === localStorage.getItem(key),
  );

export const setFullscreen = () => {
  if (Capacitor.getPlatform() === 'android') {
    AndroidFullScreen.isImmersiveModeSupported()
      .then(() => AndroidFullScreen.immersiveMode())
      .catch((e) => console.warn('Immersive mode not supported', e));
  }
};

export const clamp = (num: number, lower: number, upper: number) => {
  return Math.min(Math.max(num, lower), upper);
};

/**
 * Generate a UUID v4 string. `crypto.randomUUID` is unavailable in some
 * embedded webviews (e.g. the WKWebView behind iOS Microsoft Edge), so fall
 * back to `crypto.getRandomValues` (and `Math.random` as a last resort).
 */
export const uuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Pure-JS SHA-256 (hex) — fallback for engines without `crypto.subtle`. */
const sha256Fallback = (bytes: Uint8Array): string => {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const length = bytes.length;
  const bitLen = length * 8;
  const paddedLen = (((length + 8) >> 6) + 1) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 =
        ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^
        ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^
        (w[j - 15] >>> 3);
      const s1 =
        ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^
        ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^
        (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = h[0],
      b = h[1],
      c = h[2],
      d = h[3],
      e = h[4],
      f = h[5],
      g = h[6],
      hh = h[7];
    for (let j = 0; j < 64; j++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA256_K[j] + w[j]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  return Array.from(h, (v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
};

/**
 * SHA-256 hex digest. Uses `crypto.subtle` when available and falls back to
 * a pure-JS implementation otherwise (`crypto.subtle` requires a secure
 * context and is absent from some webviews, e.g. older iOS WKWebView).
 */
export const sha256Hex = async (data: Uint8Array | string): Promise<string> => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch (e) {
      console.warn('crypto.subtle.digest failed:', e);
    }
  }
  return sha256Fallback(bytes);
};

export const haveSameKeys = (obj1: object, obj2: object): boolean => {
  const keys1 = Object.keys(obj1).sort();
  const keys2 = Object.keys(obj2).sort();
  return JSON.stringify(keys1) === JSON.stringify(keys2);
};

export const getLines = (text: string) =>
  text.split(/\r?\n/).filter((line) => line.trim().length > 0);

export const isPec = (pecCriteria: string[]) =>
  !isNaN(parseFloat(pecCriteria[0])) && /^bp \d+(\.\d+)? \d+(\.\d+)?$/.test(pecCriteria[1]);

export const readMetadataForChart = (text?: string, chartMeta?: RpeMeta): MetadataEntry => {
  const readFromText = (text: string = '') => {
    const lines = getLines(text);
    const fields = ['Name', 'Song', 'Picture', 'Chart', 'Composer', 'Charter', 'Level'];
    if (
      lines[0] === '#' &&
      fields.every((val) => lines.findIndex((line) => line.startsWith(val)) !== -1)
    ) {
      const info = fields.map(
        (field) =>
          lines
            .find((line) => line.startsWith(field))
            ?.slice(field.length + 1)
            .trim() ?? '',
      );
      return {
        name: info[0],
        song: info[1],
        picture: info[2],
        chart: info[3],
        composer: info[4],
        charter: info[5],
        illustration: '',
        level: info[6],
      };
    }
    const [_header, ...rows] = getLines(text);
    const data = rows.map((row) => row.split(','));
    if (data.length > 0 && data[0].length >= 10) {
      let i = data.length - 1;
      while (i > 0 && data[i].length < 10) i--;
      const [
        chart,
        song,
        picture,
        _aspectRatio,
        _scaleRatio,
        _globalAlpha,
        name,
        level,
        illustrator,
        designer,
      ] = data[i];
      return {
        name,
        song,
        picture,
        chart,
        composer: '',
        charter: designer,
        illustration: illustrator,
        level,
        // aspectRatio: parseFloat(_aspectRatio),
        // scaleRatio: parseFloat(_scaleRatio),
        // globalAlpha: parseFloat(_globalAlpha),
      };
    }
    // TODO add support for other metadata formats
    console.debug('Chart metadata format not recognized:', text);
    return {
      name: '',
      song: '',
      picture: '',
      chart: '',
      composer: '',
      charter: '',
      illustration: '',
      level: '',
    };
  };

  let metadata = readFromText(text);
  if (chartMeta) {
    metadata = updateMetadata(metadata, chartMeta);
  }
  return metadata;
};

export const readMetadataForRespack = (text: string) => {
  try {
    const { id, ...rest } = JSON.parse(text) as ResourcePackWithId<string>;
    const result: ResourcePackWithId<string> = {
      id: id || uuid(),
      ...rest,
    };
    return result;
  } catch (e) {
    console.debug('Failed to parse resource pack metadata:', e);
    return null;
  }
};

export const readMetadataForPhiraRespack = (text: string) => {
  try {
    return YAML.parse(text) as PhiraResourcePack;
  } catch (e) {
    console.debug('Failed to parse Phira resource pack metadata:', e);
    return null;
  }
};

export const exportRespack = async (respack: ResourcePack<File>) => {
  const zip = new JSZip();

  const createFile = async (file: File, filename: string, fallbackExtension: string) => {
    const extension =
      (await fileTypeFromBlob(file))?.ext ??
      mime.getExtension(mime.getType(file.name) ?? '') ??
      fallbackExtension;
    filename = `${ensafeFilename(filename)}.${extension}`;
    zip.file(filename, file);
    return filename;
  };

  const metadata: ResourcePack<string> = {
    name: respack.name,
    author: respack.author,
    description: respack.description,
    thumbnail: respack.thumbnail
      ? await createFile(respack.thumbnail, 'Thumbnail', 'png')
      : undefined,
    noteSkins: await Promise.all(
      respack.noteSkins.map(async (e) => ({
        name: e.name,
        file: await createFile(e.file, e.name, 'png'),
      })),
    ),
    hitSounds: await Promise.all(
      respack.hitSounds.map(async (e) => ({
        name: e.name,
        file: await createFile(e.file, e.name, 'wav'),
      })),
    ),
    hitEffects: respack.hitEffects
      ? {
          spriteSheet: await createFile(respack.hitEffects.spriteSheet, 'HitEffects', 'png'),
          frameWidth: respack.hitEffects.frameWidth,
          frameHeight: respack.hitEffects.frameHeight,
          frameRate: respack.hitEffects.frameRate,
          particle: respack.hitEffects.particle,
        }
      : undefined,
    ending: {
      grades: await Promise.all(
        respack.ending.grades.map(async (e) => ({
          name: e.name,
          file: await createFile(e.file, e.name, 'png'),
        })),
      ),
      music: await Promise.all(
        respack.ending.music.map(async (e) => ({
          levelType: e.levelType,
          beats: e.beats,
          bpm: e.bpm,
          file: await createFile(e.file, `LevelOver${e.levelType}`, 'wav'),
        })),
      ),
    },
    fonts: await Promise.all(
      respack.fonts.map(async (e) =>
        e.type === 'bitmap'
          ? {
              name: e.name,
              type: e.type,
              texture: await createFile(e.texture, e.name, 'png'),
              descriptor: await createFile(e.descriptor, e.name, 'fnt'),
            }
          : {
              name: e.name,
              type: e.type,
              file: await createFile(e.file, e.name, e.type === 'truetype' ? 'ttf' : 'otf'),
            },
      ),
    ),
    options: respack.options,
  };

  zip.file('_META.json', JSON.stringify(metadata, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const filename = ensafeFilename(respack.name) + '.zip';
  return triggerDownload(blob, filename, 'resourcePack');
};

export const convertRespackToURL = (respack: ResourcePack<File>) => {
  const createURL = (file: File) => {
    return URL.createObjectURL(file);
  };

  const result: ResourcePack<string> = {
    name: respack.name,
    author: respack.author,
    description: respack.description,
    thumbnail: respack.thumbnail ? createURL(respack.thumbnail) : undefined,
    noteSkins: respack.noteSkins.map((e) => ({
      name: e.name,
      file: createURL(e.file),
    })),
    hitSounds: respack.hitSounds.map((e) => ({
      name: e.name,
      file: createURL(e.file),
    })),
    hitEffects: respack.hitEffects
      ? {
          spriteSheet: createURL(respack.hitEffects.spriteSheet),
          frameWidth: respack.hitEffects.frameWidth,
          frameHeight: respack.hitEffects.frameHeight,
          frameRate: respack.hitEffects.frameRate,
          particle: respack.hitEffects.particle,
        }
      : undefined,
    ending: {
      grades: respack.ending.grades.map((e) => ({
        name: e.name,
        file: createURL(e.file),
      })),
      music: respack.ending.music.map((e) => ({
        levelType: e.levelType,
        beats: e.beats,
        bpm: e.bpm,
        file: createURL(e.file),
      })),
    },
    fonts: respack.fonts.map((e) =>
      e.type === 'bitmap'
        ? {
            name: e.name,
            type: e.type,
            texture: createURL(e.texture),
            descriptor: createURL(e.descriptor),
          }
        : {
            name: e.name,
            type: e.type,
            file: createURL(e.file),
          },
    ),
    options: respack.options,
  };

  return result;
};

/** Re-zip a stored chart back into a .zip bundle for download. */
export const exportChart = async (chart: StoredChart, preserveSourceName = false) => {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  const addFile = (file: File, preferredName?: string): string => {
    let name = preferredName ?? file.name;
    let i = 2;
    while (usedNames.has(name)) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
      i++;
    }
    usedNames.add(name);
    zip.file(name, file);
    return name;
  };
  const chartName = addFile(chart.resources.chart);
  const songName = addFile(chart.resources.song);
  const illustrationName = addFile(chart.resources.illustration);
  chart.assets.forEach((asset) => addFile(asset.file, asset.name));

  // RPE metadata
  const { title, composer, charter, level } = chart.metadata;
  const info =
    [
      '#',
      `Name: ${title?.trim() ?? ''}`,
      `Path: ${new Date().getTime()}`,
      `Song: ${songName}`,
      `Picture: ${illustrationName}`,
      `Chart: ${chartName}`,
      `Level: ${level?.trim() ?? ''}`,
      `Composer: ${composer?.trim() ?? ''}`,
      `Charter: ${charter?.trim() ?? ''}`,
    ].join('\n') + '\n';
  zip.file('info.txt', info);

  const blob = await zip.generateAsync({ type: 'blob' });
  let filename: string;
  if (preserveSourceName && chart.sourceName) {
    // Re-export under the original import file name (e.g. `chart.pez`), so
    // the archive can round-trip back to its source; append .zip when the
    // source name has no extension (folder imports).
    const sourceBaseName = chart.sourceName.split(/[\\/]/).pop() || 'chart';
    const base = ensafeFilename(sourceBaseName);
    filename = /\.[A-Za-z0-9]{1,5}$/.test(base) ? base : `${base}.zip`;
  } else {
    filename = ensafeFilename(`${title ?? 'chart'} [${level ?? 'unknown'}]`) + '.zip';
  }
  return triggerDownload(blob, filename, 'chart');
};

export const updateMetadata = (metadata: MetadataEntry, chartMeta: RpeMeta) => {
  metadata.name = chartMeta.name;
  metadata.song = chartMeta.song;
  metadata.picture = chartMeta.background;
  metadata.composer = chartMeta.composer;
  metadata.charter = chartMeta.charter;
  metadata.illustration = chartMeta.illustration ?? metadata.illustration;
  metadata.level = chartMeta.level;
  return metadata;
};

export const inferLevelType = (level: string | null): LevelType => {
  if (!level) return 2;
  level = level.toLowerCase();
  if (level.includes(' ')) {
    level = level.split(' ')[0];
  }
  if (['ez', 'easy'].includes(level)) return 0;
  if (['hd', 'easy'].includes(level)) return 1;
  if (['at', 'another'].includes(level)) return 3;
  if (['sp', 'special'].includes(level)) return 4;
  return 2;
};

export const fit = (
  width: number,
  height: number,
  refWidth: number,
  refHeight: number,
  modifier: boolean = false,
) => {
  let isWide = refWidth / refHeight < width / height;
  if (modifier) {
    isWide = !isWide;
  }
  if (isWide) {
    width = (refHeight / height) * width;
    height = refHeight;
  } else {
    height = (refWidth / width) * height;
    width = refWidth;
  }
  return { width, height };
};

/**
 * Trigger a download of `blob` as `name`.
 *
 * In a normal browser this clicks an `<a download>` anchor. Tauri webviews
 * have no download manager, so that click is a silent no-op there; instead we
 * show a native save dialog and write the file directly to disk. Returns the
 * path the file was saved to (Tauri only), or `undefined` otherwise.
 */
export const triggerDownload = async (
  blob: Blob,
  name: string,
  purpose: 'adjustedOffset' | 'resourcePack' | 'chart',
  always = false,
): Promise<string | undefined> => {
  if (IS_IFRAME && purpose !== 'resourcePack' && purpose !== 'chart') {
    send({
      type: 'fileOutput',
      payload: {
        purpose,
        file: new File([blob], name),
      },
    });
    if (!always) return undefined;
  }
  if (IS_TAURI) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const extension = name.includes('.') ? name.split('.').pop()! : undefined;
    const path = await save({
      title: name,
      defaultPath: name,
      filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined,
    });
    if (!path) return undefined; // user cancelled the dialog
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return undefined;
};

export const getParams = (url?: string, loadFromStorage = true): Config | null => {
  const p = (url ? new URL(url) : page.url).searchParams;
  const song = p.get('song');
  const chart = p.get('chart');
  const illustration = p.get('illustration');
  const songName = p.get('songName') ?? undefined;
  const illustrationName = p.get('illustrationName') ?? undefined;
  const assetNames = p
    .getAll('assetNames')
    .flatMap((v) => v.split(','))
    .map((v) => decodeURIComponent(v));
  const assetTypes = p
    .getAll('assetTypes')
    .flatMap((v) => v.split(','))
    .map((v) => parseInt(v));
  const assets = p.getAll('assets').flatMap((v) => v.split(','));

  const title = p.get('title');
  const composer = p.get('composer');
  const charter = p.get('charter');
  const illustrator = p.get('illustrator');
  const level = p.get('level');
  const levelType =
    (clamp(parseInt(p.get('levelType') ?? '2'), 0, 4) as LevelType) ?? inferLevelType(level);
  const difficulty = p.get('difficulty');

  const aspectRatio: number[] | null = p.getAll('aspectRatio').map((v) => parseInt(v));
  const backgroundBlur = parseFloat(p.get('backgroundBlur') ?? '1');
  const backgroundLuminance = parseFloat(p.get('backgroundLuminance') ?? '0.5');
  const chartFlipping = parseInt(p.get('chartFlipping') ?? '0');
  const chartOffset = parseInt(p.get('chartOffset') ?? '0');
  const fcApIndicator = ['1', 'true'].some((v) => v == (p.get('fcApIndicator') ?? '1'));
  const goodJudgment = parseInt(p.get('goodJudgment') ?? '160');
  const hitSoundVolume = parseFloat(p.get('hitSoundVolume') ?? '0.75');
  const lineThickness = parseFloat(p.get('lineThickness') ?? '1');
  const musicVolume = parseFloat(p.get('musicVolume') ?? '1');
  const noteSize = parseFloat(p.get('noteSize') ?? '1');
  const perfectJudgment = parseInt(p.get('perfectJudgment') ?? '80');
  const simultaneousNoteHint = ['1', 'true'].some(
    (v) => v == (p.get('simultaneousNoteHint') ?? '1'),
  );
  const timeScale = parseFloat(p.get('timeScale') ?? '1');

  const frameRate = parseFloat(p.get('frameRate') ?? '60');
  const overrideResolution: number[] | null = p
    .getAll('overrideResolution')
    .map((v) => parseInt(v));
  const resultsLoopsToRender = parseFloat(p.get('resultsLoopsToRender') ?? '1');
  const videoCodec = p.get('videoCodec') ?? 'libx264';
  const videoBitrate = parseInt(p.get('videoBitrate') ?? '6000');
  const audioBitrate = parseInt(p.get('audioBitrate') ?? '320');
  const vsync = ['1', 'true'].some((v) => v == (p.get('vsync') ?? '1'));
  const exportPath = p.get('exportPath') ?? undefined;

  const autoplay = ['1', 'true'].some((v) => v == p.get('autoplay'));
  const practice = ['1', 'true'].some((v) => v == p.get('practice'));
  const adjustOffset = ['1', 'true'].some((v) => v == p.get('adjustOffset'));
  const render = ['1', 'true'].some((v) => v == p.get('render'));
  const autostart = ['1', 'true'].some((v) => v == p.get('autostart'));
  const newTab = ['1', 'true'].some((v) => v == p.get('newTab'));
  const inApp = parseInt(p.get('inApp') ?? '0');

  const automate = ['1', 'true'].some((v) => v == p.get('automate'));

  const chartId = p.get('chartId') ?? undefined;
  const chartCreatedAtRaw = p.get('chartCreatedAt');
  const chartCreatedAt = chartCreatedAtRaw ? parseFloat(chartCreatedAtRaw) : undefined;
  const sourceName = p.get('sourceName') ?? undefined;

  let resourcePack = DEFAULT_RESOURCE_PACK as ResourcePack<string>;
  const respackParam = p.get('resourcePack');
  if (respackParam) {
    try {
      resourcePack = JSON.parse(decodeURIComponent(respackParam)) as ResourcePack<string>;
    } catch (e) {
      console.error('Failed to parse resource pack: ', e);
    }
  }

  if (!song || !chart || !illustration || assetNames.length < assets.length) {
    if (!loadFromStorage) return null;
    const storageItem = localStorage.getItem('player');
    if (!storageItem) return null;
    const stored = JSON.parse(storageItem) as Partial<Config>;
    // One-time play options must not be replayed from storage: they are
    // single-play parameters and only meaningful when passed in the URL.
    delete stored.autoplay;
    delete stored.practice;
    delete stored.adjustOffset;
    delete stored.autostart;
    return stored as Config;
  }
  return {
    resources: {
      song,
      chart,
      illustration,
      songName,
      illustrationName,
      assetNames,
      assetTypes,
      assets,
    },
    metadata: {
      title,
      composer,
      charter,
      illustrator,
      levelType,
      level,
      difficulty: difficulty !== null ? parseFloat(difficulty) : null,
    },
    preferences: {
      aspectRatio: aspectRatio.length >= 2 ? [aspectRatio[0], aspectRatio[1]] : null,
      backgroundBlur,
      backgroundLuminance,
      chartFlipping,
      chartOffset,
      fcApIndicator,
      goodJudgment,
      hitSoundVolume,
      lineThickness,
      musicVolume,
      noteSize,
      perfectJudgment,
      simultaneousNoteHint,
      timeScale,
    },
    mediaOptions: {
      frameRate,
      overrideResolution:
        overrideResolution.length >= 2 ? [overrideResolution[0], overrideResolution[1]] : null,
      resultsLoopsToRender,
      videoCodec,
      videoBitrate,
      audioBitrate,
      vsync,
      exportPath,
    },
    resourcePack,
    autoplay,
    practice,
    adjustOffset,
    render,
    autostart,
    newTab,
    inApp,
    automate,
    chartId,
    chartCreatedAt,
    sourceName,
  };
};

export const extractTgz = async (blob: Blob): Promise<File[]> => {
  const arrayBuffer = await blob.arrayBuffer(); // Convert Blob to ArrayBuffer
  const archive = ungzip(new Uint8Array(arrayBuffer)); // Decompress .tgz
  const blockSize = 512;
  const decoder = new TextDecoder();
  const files: File[] = [];
  let offset = 0;
  let pendingPath = '';

  const readTarField = (bytes: Uint8Array, start: number, length: number) => {
    const value = decoder.decode(bytes.subarray(start, start + length));
    const nullIndex = value.indexOf('\0');
    return (nullIndex === -1 ? value : value.slice(0, nullIndex)).replace(/\s+$/u, '');
  };

  const readTarNumber = (bytes: Uint8Array, start: number, length: number) => {
    const value = readTarField(bytes, start, length).trim();
    return value ? Number.parseInt(value, 8) : 0;
  };

  const isEmptyTarBlock = (bytes: Uint8Array, start: number) => {
    for (let i = start; i < start + blockSize; i++) {
      if (bytes[i] !== 0) return false;
    }
    return true;
  };

  while (offset + blockSize <= archive.length) {
    if (isEmptyTarBlock(archive, offset)) break;

    const header = archive.subarray(offset, offset + blockSize);
    const name = readTarField(header, 0, 100);
    const prefix = readTarField(header, 345, 155);
    const type = readTarField(header, 156, 1);
    const size = readTarNumber(header, 124, 12);
    const dataStart = offset + blockSize;
    const dataEnd = dataStart + size;

    if (dataEnd > archive.length) {
      throw new Error('Invalid tar archive');
    }

    const entryPath = pendingPath || [prefix, name].filter(Boolean).join('/');
    const basename = entryPath.split('/').pop() ?? entryPath;
    const fileBytes = archive.slice(dataStart, dataEnd);

    if (type === 'L') {
      pendingPath = decoder.decode(fileBytes).replace(/[\0\n]+$/u, '');
    } else if (type === '' || type === '0') {
      if (basename) {
        files.push(new File([fileBytes], basename, { type: 'application/octet-stream' }));
      }
      pendingPath = '';
    } else {
      pendingPath = '';
    }

    offset = dataStart + Math.ceil(size / blockSize) * blockSize;
  }

  return files;
};

export const isZip = (file: File) =>
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed' ||
  /\.(?:pez|zip)$/i.test(file.name);

export const send = (message: OutgoingMessage) => parent.postMessage(message, '*');

export const versionCompare = (aString: string, bString: string) => {
  const a = aString.split('.').map((e) => parseInt(e));
  const b = bString.split('.').map((e) => parseInt(e));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a.at(i) ?? 0) < (b.at(i) ?? 0)) return -1;
    if ((a.at(i) ?? 0) > (b.at(i) ?? 0)) return 1;
  }
  return 0;
};

const notiflix = (message: string, type: 'info' | 'warning' | 'failure' | 'success' = 'info') => {
  const id = `notiflix-${type}-${performance.now()}`;
  Notiflix.Notify[type](message, {
    ID: id,
    cssAnimationStyle: 'from-right',
    showOnlyTheLastOne: false,
    opacity: 0.9,
    borderRadius: '12px',
  });
  return id;
};

export const fromRichText = (i: string) =>
  i && i.replace(/\[PZ([A-Za-z]+):([0-9]+):((?:(?!:PZRT]).)*):PZRT\]/gi, '$3');

export const ensafeFilename = (filename: string) => {
  return filename
    .split(' ')
    .filter((s) => s.trim().length > 0)
    .join(' ')
    .replaceAll(/[#%&{}\\<>*?/$!'":@`|]/g, '');
};

export const notify = (
  message: string,
  type: 'info' | 'warning' | 'failure' | 'success' = 'info',
  clickCallback?: () => void,
) => {
  const id = notiflix(message, type);
  if (!clickCallback) return;
  document
    .querySelectorAll('.notiflix-notify')
    ?.forEach((e) => e.id.startsWith(id) && e.addEventListener('click', clickCallback));
};

/**
 * Copy text to the clipboard, tolerating engines without the async
 * Clipboard API (e.g. older iOS WKWebView). Falls back to a hidden
 * textarea + `execCommand('copy')`; never throws.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    console.warn('navigator.clipboard.writeText failed:', e);
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch (e) {
    console.warn('execCommand copy failed:', e);
    return false;
  }
};

export const alertError = (error?: Error, message?: string) => {
  const type = error === null ? 'null' : error === undefined ? 'undefined' : error.constructor.name;
  let message2 = String(error);
  // let _detail = String(error);
  if (error instanceof Error) {
    // const stack = error.stack || 'Stack not available';
    message2 = `${error.name}: ${error.message}`;
    // const idx = stack.indexOf(message2) + 1;
    // if (idx) _detail = `${message2}\n${stack.slice(idx + message2.length)}`;
    // else _detail = `${message2}\n    ${stack.split('\n').join('\n    ')}`; //Safari
  }
  if (message) message2 = message;
  const errMessage = `(${m.click_to_copy()}) [${type}] ${message2.split('\n')[0]}`;
  if (IS_TAURI_LIKE)
    tauriInvoke('console_log', {
      message: message || error?.message || String(error),
      severity: 'error',
    });
  const id = notiflix(errMessage, 'failure');
  document.querySelectorAll('.notiflix-notify')?.forEach(
    (e) =>
      e.id.startsWith(id) &&
      e.addEventListener('click', async () => {
        const text = error?.stack ?? (error ? `${error.name}: ${error.message}` : errMessage);
        let ok = false;
        if (Capacitor.getPlatform() === 'web') {
          ok = await copyText(text);
        } else {
          try {
            await Clipboard.write({ string: text });
            ok = true;
          } catch (e) {
            console.warn('Clipboard.write failed:', e);
          }
        }
        if (ok) {
          Notiflix.Notify.success(m.copied(), {
            cssAnimationStyle: 'from-right',
            opacity: 0.9,
            borderRadius: '12px',
          });
        } else {
          // A plain (non-copyable) toast — never recurse into alertError.
          Notiflix.Notify.warning(m.copy_failed(), {
            cssAnimationStyle: 'from-right',
            opacity: 0.9,
            borderRadius: '12px',
          });
        }
      }),
  );
};
