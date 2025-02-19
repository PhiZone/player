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
  type PointerTap,
  type PointerDrag,
  type AlphaControl,
  type PosControl,
  type SizeControl,
  type SkewControl,
  type YControl,
  type RpeJson,
  // type RecorderOptions,
} from '$lib/types';
import { EventBus } from './EventBus';
import { getFFmpeg, loadFFmpeg } from './ffmpeg';
import type { Game } from './scenes/Game';
import { ENDING_ILLUSTRATION_CORNER_RADIUS } from './constants';
import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js';
import { dot, gcd, random } from 'mathjs';
import { fileTypeFromBlob } from 'file-type';
import parseAPNG, { type Frame } from 'apng-js';
import { fixWebmDuration } from '@fix-webm-duration/fix';
import bezier from 'bezier-easing';
import type { Line } from './objects/Line';
import { ROOT, type Node } from './objects/Node';
import { tempDir } from '@tauri-apps/api/path';
import { download as tauriDownload } from '@tauri-apps/plugin-upload';
import { readFile, remove } from '@tauri-apps/plugin-fs';
import { clamp, getLines, IS_IFRAME, IS_TAURI, isPec, send } from '$lib/utils';
import PhiEditerConverter from './converter/phiediter';
import 'context-filter-polyfill';

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
  if (IS_TAURI && url.startsWith('https://')) {
    const filePath = (await tempDir()) + random(1e17, 1e18 - 1);
    await tauriDownload(url, filePath, (payload) => {
      EventBus.emit('loading', clamp(payload.progressTotal / payload.total, 0, 1));
    });
    const data = await readFile(filePath);
    await remove(filePath);
    return new Blob([data]);
  } else {
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
  }
};

export const loadText = async (url: string, name: string): Promise<string> => {
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

export const loadChart = async (url: string, name: string = 'chart'): Promise<RpeJson | null> => {
  const text = await loadText(url, name);
  try {
    return JSON.parse(text);
  } catch {
    if (isPec(getLines(text).slice(0, 2))) {
      return PhiEditerConverter(text, {
        RPEVersion: 0,
        background: '',
        charter: '',
        composer: '',
        id: '',
        level: '',
        name: '',
        song: '',
      });
      // write your PEC to RPE conversion here
    }
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
        ctx.filter = `blur(${blurAmount}px)`;
        ctx.drawImage(img, 0, 0);
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - luminance})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const background = canvas.toDataURL();

        canvas.width = cropWidth;
        canvas.height = cropHeight;
        ctx.filter = 'none';
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

        const dimZoneHeight = cropHeight * 0.5;
        const dimnessPercent = 0.95;
        const gradient = ctx.createLinearGradient(
          0,
          canvas.height - dimZoneHeight,
          0,
          canvas.height,
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, `rgba(0, 0, 0, ${dimnessPercent})`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, canvas.height - dimZoneHeight, canvas.width, dimZoneHeight);

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
  events:
    | (Event | SpeedEvent | ColorEvent | GifEvent | TextEvent | VariableEvent)[]
    | null
    | undefined,
): void => {
  events?.forEach((event) => {
    event.startBeat = toBeats(event.startTime);
    event.endBeat = toBeats(event.endTime);
  });
  events?.sort((a, b) => a.startBeat - b.startBeat);
};

export const processControlNodes = (
  control: AlphaControl[] | PosControl[] | SizeControl[] | SkewControl[] | YControl[],
): void => {
  control.sort((a, b) => b.x - a.x);
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
      return 0xfeffa9;
    case FcApStatus.FC:
      return 0xa2eeff;
    default:
      return 0xffffff;
  }
};

export const getJudgmentColor = (type: JudgmentType): number => {
  switch (type) {
    case JudgmentType.PERFECT:
      return 0xffec9f;
    case JudgmentType.GOOD_EARLY:
    case JudgmentType.GOOD_LATE:
      return 0xb4e1ff;
    case JudgmentType.BAD:
      return 0x6b3b3a;
    default:
      return 0xffffff;
  }
};

export const easing = (
  type: number,
  bezierPoints: number[] | undefined,
  x: number,
  easingLeft: number = 0,
  easingRight: number = 1,
): number => {
  x = clamp(x, 0, 1);
  const useBezier = bezierPoints && bezierPoints.length >= 4;
  const bezierFunc = useBezier
    ? bezier(...(bezierPoints.slice(0, 4) as [number, number, number, number]))
    : undefined;
  easingLeft = useBezier ? 0 : clamp(easingLeft, 0, 1);
  easingRight = useBezier ? 1 : clamp(easingRight, 0, 1);
  if (type <= 0 || type > easingFunctions.length) return x;
  const func = bezierFunc ?? easingFunctions[type - 1] ?? easingFunctions[0];
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
    if (start.includes('%P%') && end.includes('%P%')) {
      const startNumeric = parseFloat(start.replace('%P%', ''));
      const endNumeric = parseFloat(end.replace('%P%', ''));
      if (!isNaN(startNumeric) && !isNaN(endNumeric)) {
        if (Number.isInteger(startNumeric) && Number.isInteger(endNumeric)) {
          return Math.floor(startNumeric + (endNumeric - startNumeric) * progress).toString();
        } else {
          return (startNumeric + (endNumeric - startNumeric) * progress).toFixed(3);
        }
      }
    }
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

export const getControlValue = (
  x: number,
  control:
    | { type: 'alpha'; payload: AlphaControl[] }
    | { type: 'pos'; payload: PosControl[] }
    | { type: 'size'; payload: SizeControl[] }
    | { type: 'skew'; payload: SkewControl[] }
    | { type: 'y'; payload: YControl[] },
): number => {
  let currentIndex = control.payload.findLastIndex((node) => node.x >= x);
  if (currentIndex === -1) currentIndex = 0;
  const nextIndex = currentIndex + 1 < control.payload.length ? currentIndex + 1 : currentIndex;
  return calculateValue(
    control.payload[currentIndex][control.type as keyof (typeof control.payload)[number]],
    control.payload[nextIndex][control.type as keyof (typeof control.payload)[number]],
    nextIndex === currentIndex
      ? 0
      : easing(
          control.payload[currentIndex].easing,
          undefined,
          (x - control.payload[currentIndex].x) /
            (control.payload[nextIndex].x - control.payload[currentIndex].x),
        ),
  ) as number;
};

export const getEventValue = (
  beat: number,
  event: Event | SpeedEvent | ColorEvent | TextEvent | GifEvent | VariableEvent,
) =>
  calculateValue(
    event.start,
    event.end,
    easing(
      'easingType' in event ? event.easingType : 0,
      'bezier' in event && event.bezier === 1 ? event.bezierPoints : undefined,
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
    ((event.start + (getEventValue(beat, event) as number)) *
      (getTimeSec(bpmList, beat) - getTimeSec(bpmList, event.startBeat))) /
    2
  );
};

export const getJudgmentPosition = (input: PointerTap | PointerDrag, line: Line) => {
  const vector = line.vector;
  vector.scale(dot([input.position.x - line.x, input.position.y - line.y], [vector.x, vector.y]));
  vector.add(new Phaser.Math.Vector2(line.x, line.y));
  return vector;
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

export function findPredominantBpm(bpmList: Bpm[], endTimeSec: number) {
  const bpmDurations: Map<number, number> = new Map();

  for (let i = 0; i < bpmList.length; i++) {
    const currentBpm = bpmList[i];
    const startTime = currentBpm.startTimeSec;
    const endTime = i + 1 < bpmList.length ? bpmList[i + 1].startTimeSec : endTimeSec;

    bpmDurations.set(currentBpm.bpm, (bpmDurations.get(currentBpm.bpm) || 0) + endTime - startTime);
  }

  let predominantBpm = { bpm: 0, duration: 0 };
  for (const [bpm, duration] of bpmDurations) {
    if (
      duration > predominantBpm.duration ||
      (duration === predominantBpm.duration && bpm > predominantBpm.bpm)
    ) {
      predominantBpm = { bpm, duration };
    }
  }

  return predominantBpm.bpm;
}

export const findHighlightMoments = (notes: { startTime: [number, number, number] }[]) => {
  const moments: [number, number, number][] = [];
  let lastMoment = [-Infinity, 0, 0];
  notes
    .sort((a, b) => toBeats(a.startTime) - toBeats(b.startTime))
    .forEach((note) => {
      const cur = note.startTime;
      if (isEqual(cur, lastMoment) && !isEqual(cur, moments.at(-1))) {
        moments.push(cur);
      } else {
        lastMoment = cur;
      }
    });
  return moments;
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

export const beatToArray = (beat: number | string): [number, number, number] => {
  const string = typeof beat === 'string' ? beat : `${beat}`;
  const number = parseFloat(string);
  const beatInt = Math.floor(number);
  const beatFloatStr = string.split('.')[1];

  if (beatInt === number) return [beatInt, 0, 1];

  return [beatInt, parseInt(beatFloatStr), Math.pow(10, beatFloatStr.length)];
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

export const mostFrequentElement = <T>(array: T[]) => {
  const frequencyMap = new Map<T, number>();

  array.forEach((item) => {
    frequencyMap.set(item, (frequencyMap.get(item) || 0) + 1);
  });

  let maxElement: T | null = null;
  let maxCount = 0;

  frequencyMap.forEach((count, element) => {
    if (count > maxCount) {
      maxCount = count;
      maxElement = element;
    }
  });

  return maxElement !== null
    ? { element: maxElement as T, frequency: maxCount / array.length }
    : null;
};

export const findLowestCommonAncestor = (a: Node, b: Node) => {
  if (a === ROOT)
    return {
      lca: ROOT,
      distance: Math.max(a.treeDepth, b.treeDepth),
    };
  const aAncestors = new Set([a]);
  let current: Node = a;
  while (current.parent !== ROOT) {
    aAncestors.add(current.parent);
    current = current.parent;
  }
  current = b;
  while (current !== ROOT && !aAncestors.has(current)) {
    current = current.parent;
  }
  return {
    lca: current,
    distance: Math.max(a.treeDepth, b.treeDepth) - (current?.treeDepth ?? 0),
  };
};

export const findLowestCommonAncestorArray = (array: Node[]) => {
  let current: Node = array[0];
  let distance = 0;
  for (let i = 1; i < array.length; i++) {
    if (current === ROOT) break;
    const { lca, distance: dist } = findLowestCommonAncestor(current, array[i]);
    current = lca;
    distance = Math.max(distance, dist);
  }
  return {
    lca: current,
    distance,
  };
};

export const findLeaves = (node: Node, maxDepth?: number): Node[] => {
  const leaves: Node[] = [];
  if (maxDepth === 0) return leaves;
  node.children.forEach((child) => {
    if ('shader' in child) {
      leaves.push(...findLeaves(child, maxDepth ? maxDepth - 1 : undefined));
    } else {
      leaves.push(child);
    }
  });
  return leaves;
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
  return URL.createObjectURL(
    new Blob([(data as Uint8Array).buffer as ArrayBuffer], { type: 'audio/wav' }),
  );
};

export const outputRecording = async (
  video: Blob,
  audio: Blob,
  duration: number,
  // recorderOptions: RecorderOptions,
) => {
  video = await fixWebmDuration(video, duration);
  audio = await fixWebmDuration(audio, duration);
  triggerDownload(video, 'recording.webm', 'recordedVideo');
  triggerDownload(audio, 'recording.opus', 'recordedVideo');
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

export const triggerDownload = (
  blob: Blob,
  name: string,
  purpose: 'adjustedOffset' | 'recordedVideo',
  always = false,
) => {
  if (IS_IFRAME) {
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

// TODO expect minor issues
// backgroundColorIndex unimplemented
const convertGifToSpritesheet = (gifArrayBuffer: ArrayBuffer) => {
  const gif = parseGIF(gifArrayBuffer);
  const originalFrames = decompressFrames(gif, true);
  // console.log(gif, originalFrames);

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
