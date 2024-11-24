import { get } from 'svelte/store';
import { page } from '$app/stores';
import { fetchFile } from '@ffmpeg/util';
import {
  type Event,
  type ColorEvent,
  type GifEvent,
  type SpeedEvent,
  type TextEvent,
  FcApStatus,
  JudgmentType,
  type Bpm,
  type Config,
} from './types';
import { EventBus } from './EventBus';
import { getFFmpeg, loadFFmpeg } from './ffmpeg';
import type { Game } from './scenes/Game';
import { ENDING_ILLUSTRATION_CORNER_RADIUS } from './constants';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { gcd } from 'mathjs';
import { fileTypeFromBlob } from 'file-type';

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

const download = async (url: string, type?: string) => {
  EventBus.emit('loading', 0);
  EventBus.emit(
    'loading-detail',
    url.startsWith('blob:') ? `Loading ${type ?? 'file'}` : `Downloading ${url.split('/').pop()}`,
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
  let aspectRatio: number[] | null = searchParams.getAll('aspectRatio').map((v) => parseInt(v));
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
  const autoplay = ['1', 'true'].some((v) => v == searchParams.get('autoplay'));
  const practice = ['1', 'true'].some((v) => v == searchParams.get('practice'));
  const autostart = ['1', 'true'].some((v) => v == searchParams.get('autostart'));
  const newTab = ['1', 'true'].some((v) => v == searchParams.get('newTab'));
  if (!song || !chart || !illustration || assetNames.length < assets.length) return null;
  if (aspectRatio.length === 0) aspectRatio = null;
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
      aspectRatio,
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
    autoplay,
    practice,
    autostart,
    newTab,
  };
};

export const loadChart = async (chart: string) => {
  const blob = await download(chart, 'chart');
  try {
    return JSON.parse(await blob.text());
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
  events: (Event | SpeedEvent | ColorEvent | GifEvent | TextEvent)[] | undefined,
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

export const toSecs = (beat: number, bpm: number): number => (beat / bpm) * 60;

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

export const getVal = (beat: number, event: Event | SpeedEvent): number => {
  const progress = easing(
    'easingType' in event ? event.easingType : 0,
    (beat - event.startBeat) / (event.endBeat - event.startBeat),
    'easingLeft' in event ? event.easingLeft : 0,
    'easingRight' in event ? event.easingRight : 1,
  );
  return event.start + (event.end - event.start) * progress;
};

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
    ((event.start + getVal(beat, event)) *
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

export const getAudio = async (url: string): Promise<string> => {
  const originalAudio = await download(url, 'audio');
  const type = (await fileTypeFromBlob(originalAudio))?.mime.toString() ?? '';
  console.log('can play', type, '->', document.createElement('audio').canPlayType(type)); // TODO need testing
  if (document.createElement('audio').canPlayType(type) !== '') {
    return URL.createObjectURL(originalAudio);
  }

  EventBus.emit('loading', 0);
  const ffmpeg = getFFmpeg();
  ffmpeg.on('progress', (progress) => {
    EventBus.emit('loading', clamp(progress.progress, 0, 1));
  });
  if (!ffmpeg.loaded) {
    EventBus.emit('loading-detail', 'Loading FFmpeg');
    await loadFFmpeg(({ url, received, total }) => {
      EventBus.emit('loading', clamp(received / total, 0, 1));
      EventBus.emit('loading-detail', `Downloading ${url.toString().split('/').pop()}`);
    });
  }
  EventBus.emit('loading-detail', 'Processing audio');
  await ffmpeg.writeFile('input', await fetchFile(originalAudio));
  await ffmpeg.exec(['-i', 'input', '-f', 'wav', 'output']);
  const data = await ffmpeg.readFile('output');
  return URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'audio/wav' }));
};

// expect issues
const convertGifToSpritesheet = (
  gifArrayBuffer: ArrayBuffer,
): {
  spritesheet: HTMLCanvasElement;
  frameCount: number;
  frameSize: { frameWidth: number; frameHeight: number }; // Dimensions of a single frame
  frameRate: number; // Calculated from delays
} => {
  // Parse the GIF
  const gif = parseGIF(gifArrayBuffer);
  const frames = decompressFrames(gif, true);

  const frameDelays = frames.map((frame) => frame.delay || 10); // Default to 10ms if delay is missing
  const delayGCD = frameDelays.reduce((a, b) => gcd(a, b));

  // Calculate the inherent frameRate in frames per second
  const frameRate = 1000 / delayGCD; // Delays are in milliseconds

  // Normalize the frames based on the GCD
  const normalizedFrames: ImageData[] = [];
  for (const frame of frames) {
    const repeatCount = frame.delay / delayGCD;
    for (let i = 0; i < repeatCount; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = frame.dims.width;
      canvas.height = frame.dims.height;
      const ctx = canvas.getContext('2d')!;

      // Create an ImageData object from the frame's patch
      const imageData = new ImageData(
        new Uint8ClampedArray(frame.patch),
        frame.dims.width,
        frame.dims.height,
      );
      ctx.putImageData(imageData, 0, 0);

      normalizedFrames.push(imageData);
    }
  }

  const frameCount = normalizedFrames.length;

  // Calculate dimensions of the spritesheet
  const spriteSize = frames[0].dims;
  const spritesheetWidth = Math.ceil(Math.sqrt(frameCount));
  const spritesheetHeight = Math.ceil(frameCount / spritesheetWidth);

  // Create a canvas for the spritesheet
  const spritesheetCanvas = document.createElement('canvas');
  spritesheetCanvas.width = spritesheetWidth * spriteSize.width;
  spritesheetCanvas.height = spritesheetHeight * spriteSize.height;
  const ctx = spritesheetCanvas.getContext('2d')!;

  // Draw the frames onto the spritesheet
  normalizedFrames.forEach((frame, index) => {
    const x = (index % spritesheetWidth) * spriteSize.width;
    const y = Math.floor(index / spritesheetWidth) * spriteSize.height;
    ctx.putImageData(frame, x, y);
  });

  // Return the spritesheet and metadata
  return {
    spritesheet: spritesheetCanvas,
    frameCount,
    frameSize: { frameWidth: spriteSize.width, frameHeight: spriteSize.height },
    frameRate,
  };
};

export const getGif = async (url: string) => {
  const gif = await download(url, 'image');
  const gifArrayBuffer = await gif.arrayBuffer();
  return convertGifToSpritesheet(gifArrayBuffer);
};
