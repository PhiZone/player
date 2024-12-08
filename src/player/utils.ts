import { get } from 'svelte/store';
import { page } from '$app/stores';
import { fetchFile } from '@ffmpeg/util';
import {
  type Event,
  type ColorEvent,
  type GifEvent,
  type SpeedEvent,
  type TextEvent,
  type VariableEvent,
  FcApStatus,
  JudgmentType,
  type Bpm,
  type Config,
  // type RecorderOptions,
} from './types';
import { EventBus } from './EventBus';
import { getFFmpeg, loadFFmpeg } from './ffmpeg';
import type { Game } from './scenes/Game';
import { ENDING_ILLUSTRATION_CORNER_RADIUS } from './constants';
import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js';
import { gcd } from 'mathjs';
import { fileTypeFromBlob } from 'file-type';
import parseAPNG, { Frame } from 'apng-js';
import { fixWebmDuration } from '@fix-webm-duration/fix';
import { AndroidFullScreen } from '@awesome-cordova-plugins/android-full-screen';
import { Capacitor } from '@capacitor/core';

const easingFunctions: ((x: number) => number)[] = [
  (x) => x,
  (x) => Math.sin((x * Math.PI) / 2),
  (x) => 1 - Math.cos((x * Math.PI) / 2),
  (x) => 1 - (1 - x) * (1 - x),
  (x) => x * x,
  (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  (x) => 1 - Math.pow(1 - x, 3),
  (x) => x * x * x,
  (x) => 1 - Math.pow(1 - x, 4),
  (x) => x * x * x * x,
  (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
  (x) => 1 - Math.pow(1 - x, 5),
  (x) => x * x * x * x * x,
  (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  (x) => Math.sqrt(1 - Math.pow(x - 1, 2)),
  (x) => 1 - Math.sqrt(1 - Math.pow(x, 2)),
  (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
  (x) => 2.70158 * x * x * x - 1.70158 * x * x,
  (x) =>
    x < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2,
  (x) =>
    x < 0.5
      ? (Math.pow(2 * x, 2) * ((2.59491 + 1) * 2 * x - 2.59491)) / 2
      : (Math.pow(2 * x - 2, 2) * ((2.59491 + 1) * (x * 2 - 2) + 2.59491) + 2) / 2,
  (x) =>
    x === 0
      ? 0
      : x === 1
        ? 1
        : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  (x) =>
    x === 0
      ? 0
      : x === 1
        ? 1
        : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * ((2 * Math.PI) / 3)),
  (x) =>
    x < 1 / 2.75
      ? 7.5625 * x * x
      : x < 2 / 2.75
        ? 7.5625 * (x -= 1.5 / 2.75) * x + 0.75
        : x < 2.5 / 2.75
          ? 7.5625 * (x -= 2.25 / 2.75) * x + 0.9375
          : 7.5625 * (x -= 2.625 / 2.75) * x + 0.984375,
  (x) => 1 - easingFunctions[25](1 - x),
  (x) =>
    x < 0.5 ? (1 - easingFunctions[25](1 - 2 * x)) / 2 : (1 + easingFunctions[25](2 * x - 1)) / 2,
];

const download = async (url: string, name?: string) => {
  EventBus.emit('loading', 0);
  EventBus.emit(
    'loading-detail',
    url.startsWith('blob:') ? `Loading ${name ?? 'file'}` : `Downloading ${url.split('/').pop()}`,
  );
  const response = await fetch(url);
  const contentLength = response.headers.get('content-length');
  if (!response.body) {
    throw new Error('Unable to fetch data.');
  }

  const totalSize = parseInt(contentLength ?? '-1');
  let loadedSize = 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loadedSize += value.length;
      EventBus.emit('loading', clamp(loadedSize / totalSize, 0, 1));
    }
  }

  return new Blob(chunks);
};

const testCanvasBlur = () => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return false;
  }

  canvas.width = 2;
  canvas.height = 1;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, 'black');
  gradient.addColorStop(1, 'white');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const originalPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  try {
    ctx.filter = 'blur(1px)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } catch {
    return false;
  }

  const blurredPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  for (let i = 0; i < blurredPixels.length; i++) {
    if (blurredPixels[i] !== originalPixels[i]) {
      return true;
    }
  }
  return false;
};

export const SUPPORTS_CANVAS_BLUR = testCanvasBlur(); // something only Apple can do

export const setFullscreen = () => {
  if (Capacitor.getPlatform() === 'android') {
    AndroidFullScreen.isImmersiveModeSupported()
      .then(() => AndroidFullScreen.immersiveMode())
      .catch(console.warn);
  }
};

export const inferLevelType = (level: string | null): 0 | 1 | 2 | 3 => {
  if (!level) return 2;
  level = level.toLowerCase();
  if (level.includes(' ')) {
    level = level.split(' ')[0];
  }
  if (['ez', 'easy'].includes(level)) return 0;
  if (['hd', 'easy'].includes(level)) return 1;
  if (['at', 'another'].includes(level)) return 3;
  return 2;
};

export const getParams = (): Config | null => {
  const searchParams = get(page).url.searchParams;
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
    (clamp(parseInt(searchParams.get('levelType') ?? '2'), 0, 3) as 0 | 1 | 2 | 3) ??
    inferLevelType(level);
  const difficulty = searchParams.get('difficulty');

  const aspectRatio: number[] | null = searchParams.getAll('aspectRatio').map((v) => parseInt(v));
  const backgroundBlur = parseFloat(searchParams.get('backgroundBlur') ?? '1');
  const backgroundLuminance = parseFloat(searchParams.get('backgroundLuminance') ?? '0.5');
  const chartFlipping = parseInt(searchParams.get('chartFlipping') ?? '0');
  const chartOffset = parseInt(searchParams.get('chartOffset') ?? '0');
  const fcApIndicator = ['1', 'true'].some((v) => v == (searchParams.get('fcApIndicator') ?? '1'));
  const goodJudgment = parseInt(searchParams.get('goodJudgment') ?? '160');
  const hitSoundVolume = parseFloat(searchParams.get('hitSoundVolume') ?? '1');
  const musicVolume = parseFloat(searchParams.get('musicVolume') ?? '1');
  const noteSize = parseFloat(searchParams.get('noteSize') ?? '1');
  const perfectJudgment = parseInt(searchParams.get('perfectJudgment') ?? '80');
  const simultaneousNoteHint = ['1', 'true'].some(
    (v) => v == (searchParams.get('simultaneousNoteHint') ?? '1'),
  );

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
  const fullscreen = ['1', 'true'].some((v) => v == searchParams.get('fullscreen'));
  if (!song || !chart || !illustration || assetNames.length < assets.length) {
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
      musicVolume,
      noteSize,
      perfectJudgment,
      simultaneousNoteHint,
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
    fullscreen,
  };
};

export const loadText = async (url: string, name: string) => {
  const blob = await download(url, name);
  return blob.text();
};

export const loadJson = async (url: string, name: string) => {
  try {
    return JSON.parse(await loadText(url, name));
  } catch (e) {
    console.error(e);
    return null;
  }
};

export const processIllustration = (
  imageUrl: string,
  blurAmount: number,
  luminance: number,
): Promise<{ background: string; cropped: string }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (ctx) {
        let cropWidth = img.width;
        let cropHeight = img.height;
        let cropX = 0;
        let cropY = 0;

        if (9 * img.width > 16 * img.height) {
          cropWidth = (img.height * 16) / 9;
          cropX = (img.width - cropWidth) / 2;
        } else if (9 * img.width < 16 * img.height) {
          cropHeight = (img.width * 9) / 16;
          cropY = (img.height - cropHeight) / 2;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        if (SUPPORTS_CANVAS_BLUR) ctx.filter = `blur(${blurAmount}px)`;
        ctx.drawImage(img, 0, 0);
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - luminance})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const background = canvas.toDataURL();

        canvas.width = cropWidth;
        canvas.height = cropHeight;
        if (SUPPORTS_CANVAS_BLUR) ctx.filter = 'none';
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const radius = (ENDING_ILLUSTRATION_CORNER_RADIUS * canvas.height) / 200;
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(canvas.width - radius, 0);
        ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
        ctx.lineTo(canvas.width, canvas.height - radius);
        ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
        ctx.lineTo(radius, canvas.height);
        ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();

        ctx.clip();
        ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        const cropped = canvas.toDataURL();

        resolve({ background, cropped });
      } else {
        reject('Failed to get canvas context');
      }
    };

    img.onerror = () => {
      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = 16;
      fallbackCanvas.height = 9;
      resolve({ background: fallbackCanvas.toDataURL(), cropped: fallbackCanvas.toDataURL() });
    };
  });

export const processEvents = (
  events: (Event | SpeedEvent | ColorEvent | GifEvent | TextEvent | VariableEvent)[] | undefined,
): void => {
  events?.forEach((event) => {
    event.startBeat = toBeats(event.startTime);
    event.endBeat = toBeats(event.endTime);
  });
  events?.sort((a, b) => a.startBeat - b.startBeat);
};

export const toBeats = (time: number[]): number => {
  if (time[1] == 0 || time[2] == 0) return time[0];
  return time[0] + time[1] / time[2];
};

export const isEqual = (a: number[] | undefined, b: number[] | undefined): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] * b[2] === b[1] * a[2];
};

export const rgbToHex = (rgb: number[] | undefined | null): number | undefined =>
  rgb ? (rgb[0] << 16) | (rgb[1] << 8) | rgb[2] : undefined;

export const getLineColor = (scene: Game): number => {
  const status = scene.preferences.fcApIndicator
    ? (scene.statistics?.fcApStatus ?? FcApStatus.AP)
    : FcApStatus.NONE;
  switch (status) {
    case FcApStatus.AP:
      return 0xffffb4;
    case FcApStatus.FC:
      return 0xb3ecff;
    default:
      return 0xffffff;
  }
};

export const getJudgmentColor = (type: JudgmentType): number => {
  switch (type) {
    case JudgmentType.PERFECT:
      return 0xffffa9;
    case JudgmentType.GOOD_EARLY:
    case JudgmentType.GOOD_LATE:
      return 0xc0f4ff;
    case JudgmentType.BAD:
      return 0x6b3b3a;
    default:
      return 0xffffff;
  }
};

export const clamp = (num: number, lower: number, upper: number) => {
  return Math.min(Math.max(num, lower), upper);
};

export const easing = (
  type: number,
  x: number,
  easingLeft: number = 0,
  easingRight: number = 1,
): number => {
  x = clamp(x, 0, 1);
  easingLeft = clamp(easingLeft, 0, 1);
  easingRight = clamp(easingRight, 0, 1);
  if (type <= 0 || type > easingFunctions.length) return x;
  const func = easingFunctions[type - 1] ?? easingFunctions[0];
  const progress = func(easingLeft + (easingRight - easingLeft) * x);
  const progressStart = func(easingLeft);
  const progressEnd = func(easingRight);
  return (progress - progressStart) / (progressEnd - progressStart);
};

const calculateValue = (
  start: number | number[] | string,
  end: number | number[] | string,
  progress: number,
) => {
  if (Array.isArray(start)) {
    if (Array.isArray(end)) {
      return start.map((v, i) => v + (end[i] - v) * progress);
    }
    if (typeof end === 'number') {
      return start.map((v) => v + (end - v) * progress);
    }
    return undefined;
  }
  if (Array.isArray(end)) {
    if (typeof start === 'number') {
      return end.map((v) => start + (v - start) * progress);
    }
    return undefined;
  }
  if (typeof start === 'number' && typeof end === 'number') {
    return start + (end - start) * progress;
  }
  if (typeof start === 'string' && typeof end === 'string') {
    if (start.startsWith(end)) {
      return (
        end +
        start.substring(
          end.length,
          Math.floor((start.length - end.length) * (1 - progress)) + end.length,
        )
      );
    }
    if (end.startsWith(start)) {
      return (
        start +
        end.substring(
          start.length,
          Math.floor((end.length - start.length) * progress) + start.length,
        )
      );
    }
    return progress >= 1 ? end : start;
  }
  return undefined;
};

export const getValue = (
  beat: number,
  event: Event | SpeedEvent | ColorEvent | TextEvent | GifEvent | VariableEvent,
) =>
  calculateValue(
    event.start,
    event.end,
    easing(
      'easingType' in event ? event.easingType : 0,
      (beat - event.startBeat) / (event.endBeat - event.startBeat),
      'easingLeft' in event ? event.easingLeft : 0,
      'easingRight' in event ? event.easingRight : 1,
    ),
  );

export const getIntegral = (
  event: SpeedEvent | undefined,
  bpmList: Bpm[],
  beat: number | undefined = undefined,
): number => {
  if (!event) return 0;
  if (beat === undefined || beat >= event.endBeat)
    return (
      ((event.start + event.end) *
        (getTimeSec(bpmList, event.endBeat) - getTimeSec(bpmList, event.startBeat))) /
      2
    );
  return (
    ((event.start + (getValue(beat, event) as number)) *
      (getTimeSec(bpmList, beat) - getTimeSec(bpmList, event.startBeat))) /
    2
  );
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

export const getTimeSec = (bpmList: Bpm[], beat: number): number => {
  let bpm = bpmList.findLast((bpm) => bpm.startBeat <= beat);
  if (!bpm) bpm = bpmList[0];
  return bpm.startTimeSec + ((beat - bpm.startBeat) / bpm.bpm) * 60;
};

export const getBeat = (bpmList: Bpm[], timeSec: number): number => {
  const curBpm = bpmList.find((bpm) => bpm.startTimeSec <= timeSec) ?? bpmList[0];
  return curBpm.startBeat + ((timeSec - curBpm.startTimeSec) / 60) * curBpm.bpm;
};

export const isPerfectOrGood = (type: JudgmentType) => {
  return (
    type === JudgmentType.PERFECT ||
    type === JudgmentType.GOOD_EARLY ||
    type === JudgmentType.GOOD_LATE
  );
};

export const convertTime = (input: string | number, round = false) => {
  let minutes = 0,
    seconds = 0;

  if (typeof input === 'string') {
    const list = input.split(':');
    const hasHour = list.length > 2;
    const hours = hasHour ? parseInt(list[0]) : 0;
    minutes = parseInt(list[hasHour ? 1 : 0]) + hours * 60;
    seconds = parseFloat(list[hasHour ? 2 : 1]);
  } else if (typeof input === 'number') {
    minutes = Math.floor(input / 60);
    seconds = input % 60;
  }

  return `${minutes.toString().padStart(2, '0')}:${
    round ? Math.round(seconds).toString().padStart(2, '0') : seconds.toFixed(2).padStart(5, '0')
  }`;
};

export const isZip = (file: File) =>
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed' ||
  file.name.toLowerCase().endsWith('.pez');

export const pad = (num: number, size: number) => {
  let numStr = num.toString();
  while (numStr.length < size) numStr = '0' + numStr;
  return numStr;
};

export const position = (
  array: { x: number; actualWidth: number }[],
  left: number,
  right: number,
  count?: number,
) => {
  count ??= array.length;
  const length = right - left;
  const gap =
    (length - array.slice(0, count).reduce((acc, cur) => acc + cur.actualWidth, 0)) / (count - 1);
  array.forEach((item, i) => {
    if (i === 0) item.x = left;
    else if (i < count) item.x = array[i - 1].x + array[i - 1].actualWidth + gap;
    else item.x = array[i - 1].x;
  });
};

export const calculatePrecedences = (arr: number[]) => {
  const sortedUnique = Array.from(new Set(arr)).sort((a, b) => a - b);

  const valueToNormalized: Map<number, number> = new Map();
  const step = 1 / sortedUnique.length;

  sortedUnique.forEach((value, index) => {
    valueToNormalized.set(value, index * step);
  });

  return valueToNormalized;
};

export const getAudio = async (url: string): Promise<string> => {
  const originalAudio = await download(url, 'audio');
  try {
    const type = (await fileTypeFromBlob(originalAudio))?.mime.toString() ?? '';
    console.log('can play', type, '->', document.createElement('audio').canPlayType(type)); // TODO need testing
    if (document.createElement('audio').canPlayType(type) !== '') {
      return URL.createObjectURL(originalAudio);
    }
  } catch (e) {
    console.error(e);
  }

  EventBus.emit('loading', 0);
  const ffmpeg = getFFmpeg();
  ffmpeg.on('progress', (progress) => {
    EventBus.emit('loading', clamp(progress.progress, 0, 1));
  });
  if (!ffmpeg.loaded) {
    EventBus.emit('loading-detail', 'Loading FFmpeg');
    await loadFFmpeg();
  }
  EventBus.emit('loading-detail', 'Processing audio');
  await ffmpeg.writeFile('input', await fetchFile(originalAudio));
  await ffmpeg.exec(['-i', 'input', '-f', 'wav', 'output']);
  const data = await ffmpeg.readFile('output');
  return URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'audio/wav' }));
};

export const outputRecording = async (
  video: Blob,
  audio: Blob,
  duration: number,
  // recorderOptions: RecorderOptions,
) => {
  video = await fixWebmDuration(video, duration);
  audio = await fixWebmDuration(audio, duration);
  triggerDownload(video, 'recording.webm');
  triggerDownload(audio, 'recording.opus');
  // const outputFile = `output.${recorderOptions.outputFormat.toLowerCase()}`;
  // const ffmpeg = getFFmpeg();
  // ffmpeg.on('progress', (progress) => {
  //   EventBus.emit('recording-processing', clamp(progress.progress, 0, 1));
  //   console.log(clamp(progress.progress, 0, 1));
  // });
  // if (!ffmpeg.loaded) {
  //   console.log('loading ffmpeg');
  //   EventBus.emit('recording-processing-detail', 'Loading FFmpeg');
  //   await loadFFmpeg(({ url, received, total }) => {
  //     EventBus.emit('recording-processing', clamp(received / total, 0, 1));
  //     console.log(clamp(received / total, 0, 1));
  //     EventBus.emit(
  //       'recording-processing-detail',
  //       `Downloading ${url.toString().split('/').pop()}`,
  //     );
  //   });
  // }
  // EventBus.emit('recording-processing-detail', 'Processing video');
  // await ffmpeg.writeFile('video', await fetchFile(video));
  // await ffmpeg.writeFile('audio', await fetchFile(audio));
  // ffmpeg.on('log', (e) => {
  //   console.log(e);
  // });
  // await ffmpeg.exec([
  //   '-i',
  //   'video',
  //   '-i',
  //   'audio',
  //   '-b:v',
  //   (recorderOptions.videoBitrate * 1000).toString(),
  //   ...(recorderOptions.audioBitrate
  //     ? ['-b:a', (recorderOptions.audioBitrate * 1000).toString()]
  //     : []),
  //   '-r',
  //   recorderOptions.frameRate.toString(),
  //   outputFile,
  // ]);
  // const data = await ffmpeg.readFile(outputFile);
  // triggerDownload(
  //   new Blob([(data as Uint8Array).buffer]),
  //   `recording.${recorderOptions.outputFormat.toLowerCase()}`,
  // );
};

export const triggerDownload = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

// TODO expect minor issues
// backgroundColorIndex unimplemented
const convertGifToSpritesheet = (gifArrayBuffer: ArrayBuffer) => {
  const gif = parseGIF(gifArrayBuffer);
  const originalFrames = decompressFrames(gif, true);
  console.log(gif, originalFrames);

  if (originalFrames.length === 0) {
    throw new Error('GIF has no frames');
  }

  const frameDelays = originalFrames.map((frame) => frame.delay || 10); // Default to 10ms if delay is missing
  const delayGCD = frameDelays.reduce((a, b) => gcd(a, b));

  // Calculate the inherent frameRate in frames per second
  const frameRate = 1000 / delayGCD; // Delays are in milliseconds

  const frames: ParsedFrame[] = [];
  originalFrames.forEach((frame) => {
    frames.push(...Array(frame.delay / delayGCD).fill(frame));
  });

  // Calculate dimensions of the spritesheet
  const spriteSize = frames[0].dims;
  const spritesheetWidth = Math.ceil(Math.sqrt(frames.length)) * spriteSize.width;
  const spritesheetHeight =
    Math.ceil(frames.length / Math.ceil(Math.sqrt(frames.length))) * spriteSize.height;

  // Create an intermediate canvas for rendering frames
  const intermediateCanvas = document.createElement('canvas');
  intermediateCanvas.width = spriteSize.width;
  intermediateCanvas.height = spriteSize.height;
  const intermediateCtx = intermediateCanvas.getContext('2d')!;

  // Create a canvas for the spritesheet
  const spritesheetCanvas = document.createElement('canvas');
  spritesheetCanvas.width = spritesheetWidth;
  spritesheetCanvas.height = spritesheetHeight;
  const spritesheetCtx = spritesheetCanvas.getContext('2d')!;

  let previousCanvasState: ImageData | null = null;
  // const backgroundColorIndex = gif.lsd.backgroundColorIndex; // Logical screen background color index
  const globalPalette = gif.gct; // Global color table

  // Convert palette index to RGBA color
  const getRGBAColor = (palette: Uint8Array, index: number): [number, number, number, number] => {
    if (index < 0 || index >= palette.length / 3) return [0, 0, 0, 0];
    const r = palette[index * 3];
    const g = palette[index * 3 + 1];
    const b = palette[index * 3 + 2];
    return [r, g, b, 255]; // Fully opaque
  };

  // Clear intermediate canvas with a specified background color
  const clearIntermediateCanvas = (
    ctx: CanvasRenderingContext2D,
    // palette: Uint8Array,
    // bgColorIndex: number,
  ) => {
    // const [r, g, b, a] = getRGBAColor(palette, bgColorIndex);
    ctx.clearRect(0, 0, spriteSize.width, spriteSize.height);
    // console.log('Clearing frame area', r, g, b, a);
    // ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
    // ctx.fillRect(0, 0, spriteSize.width, spriteSize.height);
  };

  // Process each frame
  frames.forEach((frame, index) => {
    const p = frame.colorTable || globalPalette;
    const palette = Uint8Array.from(p.map((value) => [value[0], value[1], value[2]]).flat());
    const transparentIndex = frame.transparentIndex;

    // Apply disposal methods
    if (frame.disposalType === 2) {
      // Clear the frame area to the background color
      clearIntermediateCanvas(intermediateCtx /*, palette, backgroundColorIndex*/);
    } else if (frame.disposalType === 3 && previousCanvasState) {
      // Restore previous canvas state
      intermediateCtx.putImageData(previousCanvasState, 0, 0);
    }

    // Save the current canvas state if the disposal type is 3
    if (frame.disposalType === 3) {
      previousCanvasState = intermediateCtx.getImageData(0, 0, spriteSize.width, spriteSize.height);
    }

    // Create ImageData from the frame patch
    const patchImageData = new ImageData(frame.patch, frame.dims.width, frame.dims.height);

    // Apply transparent pixels
    if (transparentIndex !== null) {
      const transparentColor = getRGBAColor(palette, transparentIndex);
      for (let i = 0; i < patchImageData.data.length; i += 4) {
        const r = patchImageData.data[i];
        const g = patchImageData.data[i + 1];
        const b = patchImageData.data[i + 2];
        const a = patchImageData.data[i + 3];

        if (
          r === transparentColor[0] &&
          g === transparentColor[1] &&
          b === transparentColor[2] &&
          a === transparentColor[3]
        ) {
          patchImageData.data[i + 3] = 0; // Make transparent
        }
      }
    }

    // Draw the patch onto the intermediate canvas
    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;

    const patchCtx = patchCanvas.getContext('2d')!;
    patchCtx.putImageData(new ImageData(frame.patch, frame.dims.width, frame.dims.height), 0, 0);

    // Draw onto the intermediate canvas
    intermediateCtx.drawImage(
      patchCanvas,
      0,
      0,
      frame.dims.width,
      frame.dims.height,
      frame.dims.left,
      frame.dims.top,
      frame.dims.width,
      frame.dims.height,
    );

    // Calculate spritesheet position
    const x = (index % Math.ceil(spritesheetWidth / spriteSize.width)) * spriteSize.width;
    const y =
      Math.floor(index / Math.ceil(spritesheetWidth / spriteSize.width)) * spriteSize.height;

    // Draw the intermediate canvas onto the spritesheet
    spritesheetCtx.drawImage(
      intermediateCanvas,
      0,
      0,
      spriteSize.width,
      spriteSize.height,
      x,
      y,
      spriteSize.width,
      spriteSize.height,
    );
  });

  return {
    spritesheet: spritesheetCanvas,
    frameCount: frames.length,
    frameSize: { frameWidth: spriteSize.width, frameHeight: spriteSize.height },
    frameRate,
    repeat: -1,
  };
};

const convertApngToSpritesheet = async (buffer: ArrayBuffer) => {
  const apng = parseAPNG(buffer);
  if (apng instanceof Error) {
    throw apng;
  }

  if (apng.frames.length === 0) {
    throw new Error('APNG has no frames');
  }

  const spriteSize = { width: apng.width, height: apng.height };
  const spritesheetWidth = Math.ceil(Math.sqrt(apng.frames.length)) * spriteSize.width;
  const spritesheetHeight =
    Math.ceil(apng.frames.length / Math.ceil(Math.sqrt(apng.frames.length))) * spriteSize.height;

  const frameDelays = apng.frames.map((frame) => frame.delay || 10);
  const delayGCD = frameDelays.reduce((a, b) => gcd(a, b));
  const frameRate = 1000 / delayGCD;

  const frames: Frame[] = [];
  apng.frames.forEach((frame) => {
    frames.push(...Array(frame.delay / delayGCD).fill(frame));
  });

  // Create a canvas for intermediate rendering
  const intermediateCanvas = document.createElement('canvas');
  intermediateCanvas.width = spriteSize.width;
  intermediateCanvas.height = spriteSize.height;
  const intermediateCtx = intermediateCanvas.getContext('2d')!;

  // Create the spritesheet canvas
  const spritesheetCanvas = document.createElement('canvas');
  spritesheetCanvas.width = spritesheetWidth;
  spritesheetCanvas.height = spritesheetHeight;
  const spritesheetCtx = spritesheetCanvas.getContext('2d')!;

  // Helper function to load images from blobs
  // Store the previous canvas state for APNG_DISPOSE_OP_PREVIOUS
  let previousCanvasState: ImageData | null = null;

  // Process each frame, considering blend and dispose modes
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame.imageData) continue;

    // Save the current canvas state if needed for later restoration
    if (frame.disposeOp === 2) {
      previousCanvasState = intermediateCtx.getImageData(0, 0, spriteSize.width, spriteSize.height);
    }

    // Draw current frame to the intermediate canvas
    const img = await createImageFromBlob(frame.imageData);

    if (frame.blendOp === 0) {
      // APNG_BLEND_OP_SOURCE: Clear canvas before drawing
      intermediateCtx.clearRect(0, 0, spriteSize.width, spriteSize.height);
    }
    intermediateCtx.drawImage(img, frame.left, frame.top);

    // Copy intermediate canvas to the spritesheet at the correct location
    const x = (i % Math.ceil(spritesheetWidth / spriteSize.width)) * spriteSize.width;
    const y = Math.floor(i / Math.ceil(spritesheetWidth / spriteSize.width)) * spriteSize.height;
    spritesheetCtx.drawImage(
      intermediateCanvas,
      0,
      0,
      spriteSize.width,
      spriteSize.height,
      x,
      y,
      spriteSize.width,
      spriteSize.height,
    );

    // Handle dispose mode
    if (frame.disposeOp === 1) {
      // APNG_DISPOSE_OP_BACKGROUND: Clear affected frame area
      intermediateCtx.clearRect(frame.left, frame.top, frame.width, frame.height);
    } else if (frame.disposeOp === 2 && previousCanvasState) {
      // APNG_DISPOSE_OP_PREVIOUS: Restore the previous canvas state
      intermediateCtx.putImageData(previousCanvasState, 0, 0);
    }
  }

  return {
    spritesheet: spritesheetCanvas,
    frameCount: frames.length,
    frameSize: { frameWidth: spriteSize.width, frameHeight: spriteSize.height },
    frameRate,
    repeat: apng.numPlays > 0 ? apng.numPlays : -1,
  };
};

const createImageFromBlob = (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = URL.createObjectURL(blob);
  });

export const getSpritesheet = async (url: string, isGif = false) => {
  const resp = await download(url, 'image');
  const buffer = await resp.arrayBuffer();
  return isGif ? convertGifToSpritesheet(buffer) : convertApngToSpritesheet(buffer);
};
