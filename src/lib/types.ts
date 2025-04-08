import type { GameObjects, Math } from 'phaser';

export interface Config {
  resources: Resources;
  metadata: Metadata;
  preferences: Preferences;
  mediaOptions: MediaOptions;
  resourcePack: ResourcePack<string>;
  autoplay: boolean;
  practice: boolean;
  adjustOffset: boolean;
  render: boolean;
  autostart: boolean;
  newTab: boolean;
  inApp: number;
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
  levelType: LevelType;
  level: string | null;
  difficulty: number | null;
}

export interface PlayOptions {
  preferences?: Preferences;
  mediaOptions?: MediaOptions;
  autoplay?: boolean;
  practice?: boolean;
  adjustOffset?: boolean;
  render?: boolean;
  autostart?: boolean;
  newTab?: boolean;
  inApp?: number;
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
  lineThickness: number;
  musicVolume: number;
  noteSize: number;
  perfectJudgment: number;
  simultaneousNoteHint: boolean;
  timeScale: number;
}

export interface MediaOptions {
  frameRate: number;
  overrideResolution: [number, number] | null;
  resultsLoopsToRender: number;
  videoCodec: string;
  videoBitrate: number;
  audioBitrate: number;
  vsync: boolean;
  exportPath?: string;
}

export type LevelType = 0 | 1 | 2 | 3 | 4;

export interface MetadataEntry {
  id?: number;
  name: string;
  song: string;
  picture: string;
  chart: string;
  composer: string;
  charter: string;
  illustration: string;
  level: string;
}

export interface RpeJson {
  BPMList: Bpm[];
  META: RpeMeta;
  chartTime: number;
  judgeLineGroup: string[];
  judgeLineList: JudgeLine[];
  multiLineString: string;
  multiScale: number;
}

export interface JudgeLine {
  attachUI?: 'pause' | 'combonumber' | 'combo' | 'score' | 'bar' | 'name' | 'level' | null;
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
  scaleOnNotes?: 0 | 1 | 2;
  appearanceOnAttach?: 0 | 1 | 2;
  sizeControl: SizeControl[];
  skewControl: SkewControl[];
  yControl: YControl[];
  zIndex?: number;
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
  zIndex?: number;
  zIndexHitEffects?: number;
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
  alphaEvents?: Event[] | null;
  moveXEvents?: Event[] | null;
  moveYEvents?: Event[] | null;
  rotateEvents?: Event[] | null;
  speedEvents?: SpeedEvent[] | null;
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

export interface RpeMeta {
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

export type GameObject =
  | GameObjects.Container
  | GameObjects.Layer
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
  zIndex?: number;
  attach?: {
    line: number;
    positionXFactor?: number;
    positionYFactor?: number;
    rotationFactor?: number;
    alphaFactor?: number;
    tintFactor?: number;
    scaleXMode?: 0 | 1 | 2;
    scaleYMode?: 0 | 1 | 2;
  };
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

export type Variable = AnimatedVariable | number | number[] | string;

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

interface AssetUploader {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  user_view_type: string;
  site_admin: boolean;
}

interface Asset {
  url: string;
  id: number;
  node_id: string;
  name: string;
  label: string;
  uploader: AssetUploader;
  content_type: string;
  state: string;
  size: number;
  download_count: number;
  created_at: string;
  updated_at: string;
  browser_download_url: string;
}

interface Author {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  user_view_type: string;
  site_admin: boolean;
}

export interface Release {
  url: string;
  assets_url: string;
  upload_url: string;
  html_url: string;
  id: number;
  author: Author;
  node_id: string;
  tag_name: string;
  target_commitish: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string;
  assets: Asset[];
  tarball_url: string;
  zipball_url: string;
  body: string;
}

export interface FFmpegEncoder {
  name: string;
  displayName: string;
  codec: string | null;
}

export interface Sound {
  key: string;
  data: string;
}

export interface Timestamp {
  sound: string;
  time: number;
  volume: number;
  rate?: number;
}

export type IncomingMessage = BlobInputMessage | UrlInputMessage | PlayMessage;

export type OutgoingMessage =
  | EventMessage
  | InputResponseMessage
  | ChartBundleMessage
  | FileOutputMessage;

export interface BlobInputMessage {
  type: 'zipInput' | 'fileInput';
  payload: {
    input: Blob[];
    replacee?: number;
  };
}

export interface UrlInputMessage {
  type: 'zipUrlInput' | 'fileUrlInput';
  payload: {
    input: string[];
    replacee?: number;
  };
}

export interface PlayMessage {
  type: 'play';
  payload: Config | PlayOptions;
}

export interface InputResponseMessage {
  type: 'inputResponse';
  payload: {
    bundlesResolved: number;
  };
}

export interface ChartBundleMessage {
  type: 'bundle';
  payload: {
    metadata: Metadata;
    resources: {
      song: File;
      chart: File;
      illustration: File;
      assets: {
        name: string;
        type: number;
        file: File;
      }[];
    };
  };
}

export interface FileOutputMessage {
  type: 'fileOutput';
  payload: {
    purpose: 'adjustedOffset' | 'renderedVideo';
    file: File;
  };
}

export interface EventMessage {
  type: 'event';
  payload: {
    name:
      | 'ready'
      | 'errored'
      | 'started'
      | 'progress'
      | 'paused'
      | 'resumed'
      | 'restarted'
      | 'finished';
    value?: number;
  };
}

export type ResourcePackWithId<T> = ResourcePack<T> & {
  id: string;
};

export interface ResourcePack<T> {
  name: string;
  author: string;
  description?: string;
  thumbnail?: T;
  noteSkins: NoteSkin<T>[];
  hitSounds: HitSound<T>[];
  hitEffects?: HitEffects<T>;
  ending: Ending<T>;
  fonts: (Font<T> | BitmapFont<T>)[];
  options?: {
    holdBodyRepeat?: boolean;
    holdCompact?: boolean;
  };
}

export type NoteSkinName =
  | 'Tap'
  | 'TapHL'
  | 'HoldHead'
  | 'HoldBody'
  | 'HoldTail'
  | 'HoldHeadHL'
  | 'HoldBodyHL'
  | 'HoldTailHL'
  | 'Flick'
  | 'FlickHL'
  | 'Drag'
  | 'DragHL';

export interface NoteSkin<T> {
  name: NoteSkinName;
  file: T;
}

export type HitSoundName = 'Tap' | 'Flick' | 'Drag';

export interface HitSound<T> {
  name: HitSoundName;
  file: T;
}

interface Particle {
  count: number;
}

export interface OrdinaryParticle extends Particle {
  style: 'circle' | 'square';
}

export interface PolygonParticle extends Particle {
  style: 'polygon';
  points: [number, number][];
}

export interface HitEffects<T> {
  spriteSheet: T;
  frameWidth: number;
  frameHeight: number;
  frameRate: number;
  colorPerfect?: [number, number, number, number];
  colorGood?: [number, number, number, number];
  particle: OrdinaryParticle | PolygonParticle;
}

export interface Font<T> {
  name: string;
  type: 'truetype' | 'opentype';
  file: T;
}

export interface BitmapFont<T> {
  name: string;
  type: 'bitmap';
  texture: T;
  descriptor: T;
}

export interface Ending<T> {
  grades: GradeLetter<T>[];
  music: ResultsMusic<T>[];
}

export type GradeLetterName = 'A' | 'B' | 'C' | 'F' | 'Phi' | 'S' | 'V-FC' | 'V';

export interface GradeLetter<T> {
  name: GradeLetterName;
  file: T;
}

export interface ResultsMusic<T> {
  levelType: LevelType;
  beats: number;
  bpm: number;
  file: T;
}

export interface PhiraResourcePack {
  name: string;
  author: string;
  description: string;
  hitFx: [number, number];
  holdAtlas: [number, number];
  holdAtlasMH: [number, number];
  hitFxDuration?: number;
  hideParticles?: boolean;
  holdRepeat?: boolean;
  holdCompact?: boolean;
  colorPerfect?: number;
  colorGood?: number;
}
