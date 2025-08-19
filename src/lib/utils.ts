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
} from './types';
import { AndroidFullScreen } from '@awesome-cordova-plugins/android-full-screen';
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import Notiflix from 'notiflix';
import mime from 'mime/lite';
import JSZip from 'jszip';
import * as YAML from 'yaml';
import tar from 'tar-stream';
import { ungzip } from 'pako';
import { fileTypeFromBlob } from 'file-type';
import { DEFAULT_RESOURCE_PACK } from './player/constants';
import { m } from './paraglide/messages';
import { invoke } from '@tauri-apps/api/core';

export const IS_TAURI = '__TAURI_INTERNALS__' in window;

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
      id: id || crypto.randomUUID(),
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
  triggerDownload(blob, filename, 'resourcePack');
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

export const triggerDownload = (
  blob: Blob,
  name: string,
  purpose: 'adjustedOffset' | 'resourcePack',
  always = false,
) => {
  if (IS_IFRAME && purpose !== 'resourcePack') {
    send({
      type: 'fileOutput',
      payload: {
        purpose,
        file: new File([blob], name),
      },
    });
    if (!always) return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export const getParams = (url?: string, loadFromStorage = true): Config | null => {
  const p = (url ? new URL(url) : page.url).searchParams;
  const song = p.get('song');
  const chart = p.get('chart');
  const illustration = p.get('illustration');
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
    return storageItem ? JSON.parse(storageItem) : null;
  }
  return {
    resources: {
      song,
      chart,
      illustration,
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
  };
};

export const extractTgz = async (blob: Blob): Promise<File[]> => {
  const arrayBuffer = await blob.arrayBuffer(); // Convert Blob to ArrayBuffer
  const ungzipped = ungzip(new Uint8Array(arrayBuffer)); // Decompress .tgz
  const extract = tar.extract(); // Create a tar extractor

  return new Promise((resolve, reject) => {
    const files: File[] = [];

    extract.on('entry', (header, stream, next) => {
      const chunks: Uint8Array<ArrayBuffer>[] = [];

      stream.on('data', (chunk) => chunks.push(new Uint8Array(chunk)));
      stream.on('end', () => {
        const fileBlob = new Blob(chunks, { type: 'application/octet-stream' });
        files.push(new File([fileBlob], header.name.split('/').pop() ?? ''));
        next();
      });

      stream.resume();
    });

    extract.on('finish', () => resolve(files));
    extract.on('error', reject);

    extract.end(ungzipped);
  });
};

export const isZip = (file: File) =>
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed' ||
  file.name.toLowerCase().endsWith('.pez');

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
  if (IS_TAURI)
    invoke('console_log', {
      message: message || error?.message || String(error),
      severity: 'error',
    });
  const id = notiflix(errMessage, 'failure');
  document.querySelectorAll('.notiflix-notify')?.forEach(
    (e) =>
      e.id.startsWith(id) &&
      e.addEventListener('click', async () => {
        const text = error?.stack ?? (error ? `${error.name}: ${error.message}` : errMessage);
        if (Capacitor.getPlatform() === 'web') navigator.clipboard.writeText(text);
        else await Clipboard.write({ string: text });
        Notiflix.Notify.success(m.copied(), {
          cssAnimationStyle: 'from-right',
          opacity: 0.9,
          borderRadius: '12px',
        });
      }),
  );
};
