import type { GameObjects, Math } from 'phaser';

export interface Config {
  resources: Resources;
  metadata: Metadata;
  preferences: Preferences;
  recorderOptions: RecorderOptions;
  autoplay: boolean;
  practice: boolean;
  adjustOffset: boolean;
  record: boolean;
  autostart: boolean;
  newTab: boolean;
}

export interface Resources {
  song: string;
  chart: string;
  illustration: string;
  assetNames: string[];
  assetTypes: number[];
  assets: string[];
}

export interface Metadata {
  title: string | null;
  composer: string | null;
  charter: string | null;
  illustrator: string | null;
  levelType: 0 | 1 | 2 | 3 | 4;
  level: string | null;
  difficulty: number | null;
}

export interface Preferences {
  aspectRatio: [number, number] | null;
  backgroundBlur: number;
  backgroundLuminance: number;
  chartFlipping: number;
  chartOffset: number;
  fcApIndicator: boolean;
  goodJudgment: number;
  hitSoundVolume: number;
  musicVolume: number;
  noteSize: number;
  perfectJudgment: number;
  simultaneousNoteHint: boolean;
}

export interface RecorderOptions {
  frameRate: number;
  overrideResolution: [number, number] | null;
  endingLoopsToRecord: number;
  outputFormat: string;
  videoBitrate: number;
  audioBitrate?: number | undefined;
}

export interface RpeJson {
  BPMList: Bpm[];
  META: Meta;
  chartTime: number;
  judgeLineGroup: string[];
  judgeLineList: JudgeLine[];
  multiLineString: string;
  multiScale: number;
}

export interface JudgeLine {
  attachUI?: 'pause' | 'combonumber' | 'combo' | 'score' | 'bar' | 'name' | 'level';
  Group: number;
  Name: string;
  Texture: string;
  alphaControl: AlphaControl[];
  anchor?: number[];
  bpmfactor: number;
  eventLayers: (EventLayer | null)[];
  extended?: Extended;
  father: number;
  isCover: number;
  isGif?: boolean;
  notes?: Note[];
  numOfNotes: number;
  posControl: PosControl[];
  scaleOnNotes?: number;
  sizeControl: SizeControl[];
  skewControl: SkewControl[];
  yControl: YControl[];
  zOrder: number;
}

export interface YControl {
  easing: number;
  x: number;
  y: number;
}

export interface SkewControl {
  easing: number;
  skew: number;
  x: number;
}

export interface SizeControl {
  easing: number;
  size: number;
  x: number;
}

export interface PosControl {
  easing: number;
  pos: number;
  x: number;
}

export interface Note {
  above: number;
  alpha: number;
  endTime: [number, number, number];
  endBeat: number;
  isFake: number;
  positionX: number;
  size: number;
  speed: number;
  startTime: [number, number, number];
  startBeat: number;
  type: number;
  visibleTime: number;
  yOffset: number;
  hitsound?: string;
  tint?: [number, number, number] | null;
  tintHitEffects?: [number, number, number] | null;
}

export interface Extended {
  gifEvents?: GifEvent[];
  inclineEvents?: Event[];
  scaleXEvents?: Event[];
  scaleYEvents?: Event[];
  colorEvents?: ColorEvent[];
  textEvents?: TextEvent[];
}

export interface TextEvent {
  bezier: number;
  bezierPoints: number[];
  easingLeft: number;
  easingRight: number;
  easingType: number;
  end: string;
  endTime: [number, number, number];
  endBeat: number;
  linkgroup: number;
  start: string;
  startTime: [number, number, number];
  startBeat: number;
}

export interface ColorEvent {
  bezier: number;
  bezierPoints: number[];
  easingLeft: number;
  easingRight: number;
  easingType: number;
  end: [number, number, number];
  endTime: [number, number, number];
  endBeat: number;
  linkgroup: number;
  start: [number, number, number];
  startTime: [number, number, number];
  startBeat: number;
}

export interface GifEvent {
  easingType: number;
  end: number;
  endTime: [number, number, number];
  endBeat: number;
  linkgroup: number;
  start: number;
  startTime: [number, number, number];
  startBeat: number;
}

export interface EventLayer {
  alphaEvents?: Event[];
  moveXEvents?: Event[];
  moveYEvents?: Event[];
  rotateEvents?: Event[];
  speedEvents?: SpeedEvent[];
}

export interface SpeedEvent {
  end: number;
  endTime: [number, number, number];
  endBeat: number;
  linkgroup: number;
  start: number;
  startTime: [number, number, number];
  startBeat: number;
}

export interface Event {
  bezier: number;
  bezierPoints: number[];
  easingLeft: number;
  easingRight: number;
  easingType: number;
  end: number;
  endTime: [number, number, number];
  endBeat: number;
  linkgroup: number;
  start: number;
  startTime: [number, number, number];
  startBeat: number;
}

export interface AlphaControl {
  alpha: number;
  easing: number;
  x: number;
}

interface Meta {
  RPEVersion: number;
  background: string;
  charter: string;
  composer: string;
  duration?: number;
  id: string;
  illustration?: string;
  level: string;
  name: string;
  offset: number;
  song: string;
}

export interface Bpm {
  bpm: number;
  startTime: [number, number, number];
  startBeat: number;
  startTimeSec: number;
}

export interface PointerTap {
  id: number;
  time: number;
  position: Math.Vector2;
  distance: number;
  spaceTimeDistance: number;
}

export interface PointerDrag {
  id: number;
  time: number;
  position: Math.Vector2;
  velocity: Math.Vector2;
  velocityConsumed: Math.Vector2 | null;
  distance: number;
}

export enum GameStatus {
  LOADING,
  READY,
  ERROR,
  PLAYING,
  SEEKING,
  PAUSED,
  FINISHED,
  DESTROYED,
}

export enum JudgmentType {
  UNJUDGED,
  PERFECT,
  GOOD_EARLY,
  GOOD_LATE,
  BAD,
  MISS,
  PASSED,
}

export enum FcApStatus {
  NONE,
  FC,
  AP,
}

export enum Grade {
  F,
  C,
  B,
  A,
  S,
  V,
  FC,
  AP,
}

export interface RegisteredObject {
  object: GameObject;
  depth: number;
  upperDepth?: number;
  occupied: { [key: string]: boolean };
}

export type GameObject =
  | GameObjects.Container
  | GameObjects.Image
  | GameObjects.Video
  | GameObjects.Sprite
  | GameObjects.Rectangle
  | GameObjects.Text;

export interface PhiraExtra {
  bpm?: {
    time: [number, number, number];
    bpm: number;
  }[];
  videos?: Video[];
  effects: ShaderEffect[];
}

export interface Video {
  path: string;
  time: [number, number, number];
  startTimeSec: number;
  endTimeSec: number;
  scale: 'cropCenter' | 'inside' | 'fit';
  alpha: AnimatedVariable | number;
  dim: AnimatedVariable | number;
}

export interface ShaderEffect {
  start: [number, number, number];
  startBeat: number;
  end: [number, number, number];
  endBeat: number;
  shader: string;
  global: boolean;
  targetRange?: {
    minZIndex: number;
    maxZIndex: number;
    exclusive?: boolean;
  };
  vars?: {
    [key: string]: Variable;
  };
}

export type Variable = AnimatedVariable | number | number[];

export type AnimatedVariable = VariableEvent[];

export type VariableEvent = ScalarVariableEvent | VectorVariableEvent;

interface ScalarVariableEvent extends BaseVariableEvent {
  start: number;
  end: number;
}

interface VectorVariableEvent extends BaseVariableEvent {
  start: number[];
  end: number[];
}

interface BaseVariableEvent {
  startTime: [number, number, number];
  startBeat: number;
  endTime: [number, number, number];
  endBeat: number;
  easingType: number;
}
