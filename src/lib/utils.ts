import { page } from '$app/state';
import { type Config, type MetadataEntry, type OutgoingMessage, type RpeMeta } from './types';
import { AndroidFullScreen } from '@awesome-cordova-plugins/android-full-screen';
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import Notiflix from 'notiflix';
import 'context-filter-polyfill';

export const IS_TAURI = '__TAURI_INTERNALS__' in window;

export const IS_IOS = (() => {
  const iosQuirkPresent = function () {
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

export const readMetadata = (text?: string, chartMeta?: RpeMeta): MetadataEntry => {
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
    console.debug('Metadata format not recognized: ', text);
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

export const inferLevelType = (level: string | null): 0 | 1 | 2 | 3 | 4 => {
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

export const getParams = (url?: string, loadFromStorage = true): Config | null => {
  const searchParams = (url ? new URL(url) : page.url).searchParams;
  const song = searchParams.get('song');
  const chart = searchParams.get('chart');
  const illustration = searchParams.get('illustration');
  const assetNames = searchParams.getAll('assetNames');
  const assetTypes = searchParams.getAll('assetTypes').map((v) => parseInt(v));
  const assets = searchParams.getAll('assets');

  const title = searchParams.get('title');
  const composer = searchParams.get('composer');
  const charter = searchParams.get('charter');
  const illustrator = searchParams.get('illustrator');
  const level = searchParams.get('level');
  const levelType =
    (clamp(parseInt(searchParams.get('levelType') ?? '2'), 0, 4) as 0 | 1 | 2 | 3 | 4) ??
    inferLevelType(level);
  const difficulty = searchParams.get('difficulty');

  const aspectRatio: number[] | null = searchParams.getAll('aspectRatio').map((v) => parseInt(v));
  const backgroundBlur = parseFloat(searchParams.get('backgroundBlur') ?? '1');
  const backgroundLuminance = parseFloat(searchParams.get('backgroundLuminance') ?? '0.5');
  const chartFlipping = parseInt(searchParams.get('chartFlipping') ?? '0');
  const chartOffset = parseInt(searchParams.get('chartOffset') ?? '0');
  const fcApIndicator = ['1', 'true'].some((v) => v == (searchParams.get('fcApIndicator') ?? '1'));
  const goodJudgment = parseInt(searchParams.get('goodJudgment') ?? '160');
  const hitSoundVolume = parseFloat(searchParams.get('hitSoundVolume') ?? '0.75');
  const lineThickness = parseFloat(searchParams.get('lineThickness') ?? '1');
  const musicVolume = parseFloat(searchParams.get('musicVolume') ?? '1');
  const noteSize = parseFloat(searchParams.get('noteSize') ?? '1');
  const perfectJudgment = parseInt(searchParams.get('perfectJudgment') ?? '80');
  const simultaneousNoteHint = ['1', 'true'].some(
    (v) => v == (searchParams.get('simultaneousNoteHint') ?? '1'),
  );
  const timeScale = parseFloat(searchParams.get('timeScale') ?? '1');

  const frameRate = parseFloat(searchParams.get('frameRate') ?? '60');
  const overrideResolution: number[] | null = searchParams
    .getAll('overrideResolution')
    .map((v) => parseInt(v));
  const endingLoopsToRecord = parseFloat(searchParams.get('endingLoopsToRecord') ?? '1');
  const outputFormat = searchParams.get('outputFormat') ?? 'mp4';
  const videoBitrate = parseInt(searchParams.get('videoBitrate') ?? '6000');
  const audioBitrate = parseInt(searchParams.get('audioBitrate') ?? '320');

  const autoplay = ['1', 'true'].some((v) => v == searchParams.get('autoplay'));
  const practice = ['1', 'true'].some((v) => v == searchParams.get('practice'));
  const adjustOffset = ['1', 'true'].some((v) => v == searchParams.get('adjustOffset'));
  const record = ['1', 'true'].some((v) => v == searchParams.get('record'));
  const autostart = ['1', 'true'].some((v) => v == searchParams.get('autostart'));
  const newTab = ['1', 'true'].some((v) => v == searchParams.get('newTab'));
  const inApp = parseInt(searchParams.get('inApp') ?? '0');
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
    recorderOptions: {
      frameRate,
      overrideResolution:
        overrideResolution.length >= 2 ? [overrideResolution[0], overrideResolution[1]] : null,
      endingLoopsToRecord,
      outputFormat,
      videoBitrate,
      audioBitrate,
    },
    autoplay,
    practice,
    adjustOffset,
    record,
    autostart,
    newTab,
    inApp,
  };
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
  const errMessage = `(Click to copy) [${type}] ${message2.split('\n')[0]}`;
  const id = notiflix(errMessage, 'failure');
  document.querySelectorAll('.notiflix-notify')?.forEach(
    (e) =>
      e.id.startsWith(id) &&
      e.addEventListener('click', async () => {
        const text = error?.stack ?? (error ? `${error.name}: ${error.message}` : errMessage);
        if (Capacitor.getPlatform() === 'web') navigator.clipboard.writeText(text);
        else await Clipboard.write({ string: text });
        Notiflix.Notify.success('Error copied to clipboard', {
          cssAnimationStyle: 'from-right',
          opacity: 0.9,
          borderRadius: '12px',
        });
      }),
  );
};
