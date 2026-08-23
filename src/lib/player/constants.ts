import { base } from '$app/paths';
import type { LevelType } from '$lib/types';

/*
    The text to display underneath the combo counter.
*/
export const COMBO_TEXT = 'COMBO';

/*
    The size of hit effects, which will be scaled by the note size from the preferences.
*/
export const HIT_EFFECTS_SIZE = 1.1;

/*
    The size of hit effects particles, which will be scaled by HIT_EFFECTS_SIZE.
*/
export const HIT_EFFECTS_PARTICLE_SIZE = 27;

/*
    The sidelength (in pixels) of the square area in which the hit effects particles will be
    randomly scattered, which will be scaled by HIT_EFFECTS_SIZE.
*/
export const HIT_EFFECTS_PARTICLE_SPREAD_RANGE = 400;

/*
    The base size of notes, which will be scaled by the note size from the preferences.
*/
export const NOTE_BASE_SIZE = 0.19;

/*
    The priorities for each note type. A note with a higher priority will be rendered on top of those with relatively lower priorities.
*/
export const NOTE_PRIORITIES = [0, 3, 1, 4, 2];

/*
    Judgment system constants, following the official Phigros judgment
    mechanics (https://www.bilibili.com/opus/1226031520301449218).

    All time values are in seconds; all spatial values are in world units
    (1 world unit = 1/10 of the screen height).
*/

/*
    Default judgment windows (ms). With these defaults the RKS factor is
    exactly 1.0: Perfect = 80, Good = 180, Bad = Good + 40 = 220.
*/
export const DEFAULT_PERFECT_JUDGMENT_MS = 80;
export const DEFAULT_GOOD_JUDGMENT_MS = 180;

/*
    Extra Bad window beyond the Good window (Bad = Good + BAD_EXTRA).
*/
export const BAD_EXTRA = 0.04;

/*
    Flick time range as a factor of the Perfect range (F = FLICK_P_FACTOR * P).
*/
export const FLICK_P_FACTOR = 1.75;

/*
    Drag time range (unaffected by judgment-window preferences).
*/
export const DRAG_TIME_RANGE = 0.1;

/*
    Horizontal half-widths of the matching bands:
    - Tap/Hold click matching and Hold body tracking: ±1.9
    - Drag matching / flick matching: ±2.1
    - Click-matching Bad-range shrink begins beyond ±0.9
*/
export const TAP_X_RANGE = 1.9;
export const HOLD_X_RANGE = 1.9;
export const WIDE_X_RANGE = 2.1;
export const BAD_SHRINK_X = 0.9;

/*
    Weighted Manhattan distance y weight used to disambiguate simultaneous
    notes during click/flick matching: m = |dx| + |dy / 2.2|.
*/
export const METRIC_Y_WEIGHT_DIVISOR = 2.2;

/*
    Two candidates within this time difference are considered simultaneous for
    match replacement purposes.
*/
export const MATCH_TIME_EPS = 0.01;

/*
    A matched note scores once the input is at least this much past the note
    time (Drag/Flick/Drag-marked scoring threshold).
*/
export const SCORE_DT_EPS = 0.005;

/*
    Hold tail settle window: a held hold finalizes this long before its tail.
*/
export const HOLD_TAIL_SETTLE = 0.22;

/*
    A hold whose head was never hit is missed this long after its tail.
*/
export const HOLD_TAIL_MISS = 0.25;

/*
    Initial "lift protection" charges for holds (frames a finger may be absent
    before the hold misses; S=2 allows 3 absent frames).
*/
export const HOLD_SAFE_FRAMES = 2;

/*
    Flick gesture speed thresholds, in "world units per 1/60s frame":
    u = SPEED_UNIT_FACTOR * dpi / SPEED_UNIT_DPI, and a new flick gesture
    requires v >= u * FLICK_SPEED_FACTOR.
*/
export const SPEED_UNIT_FACTOR = 0.06;
export const SPEED_UNIT_DPI = 380;
export const FLICK_SPEED_FACTOR = 5;

/*
    Below this displacement magnitude (world units) the projection step of the
    flick-gesture detection is skipped (v_rel treated as 0).
*/
export const FLICK_PROJECTION_MIN = 0.1;

/*
    Reference DPI used on the web where the physical screen DPI is unknown:
    dpi ≈ BASE_DPI * devicePixelRatio.
*/
export const WEB_BASE_DPI = 96;
/*
    The radius (in percentage) of rounded corners of the illustration on the results scene.
    0 for no rounding; 100 for full rounding.
*/
export const RESULTS_ILLUSTRATION_CORNER_RADIUS = 12;

/*
    The regular expression to match keyboard inputs for playing.
*/
export const KEYBOARD_INPUT_REGEX = /^[0-9a-z`\-=[\]\\;',./ ]$/;

/*
    The maximum dimension (width or height) of images on mobile platforms. Images exceeding
    this limit will be scaled down proportionally before being handed to Phaser, to prevent
    issues with high-resolution/large images on devices with limited resources.
*/
export const MOBILE_MAX_IMAGE_DIMENSION = 2048;

export const DEFAULT_RESOURCE_PACK_ID = '__default__';

/*
    The default resource pack to use when no resource pack is specified or imported.
*/
export const DEFAULT_RESOURCE_PACK = {
  id: DEFAULT_RESOURCE_PACK_ID,
  name: 'Default',
  author: '星鹿ELEC, Supa7onyz & Naptie',
  description: 'The default look of PhiZone Player.',
  thumbnail: `${base}/banner.png`,
  noteSkins: [
    'Tap',
    'TapHL',
    'HoldHead',
    'HoldBody',
    'HoldTail',
    'HoldHeadHL',
    'HoldBodyHL',
    'HoldTailHL',
    'Flick',
    'FlickHL',
    'Drag',
    'DragHL',
  ].map((name) => {
    return {
      name,
      file: `${base}/game/notes/${name}.png`,
    };
  }),
  hitSounds: ['Tap', 'Flick', 'Drag'].map((name) => {
    return {
      name,
      file: `${base}/game/hitsounds/${name}.wav`,
    };
  }),
  hitEffects: {
    spriteSheet: `${base}/game/HitEffects.png`,
    frameWidth: 375,
    frameHeight: 378,
    frameRate: 128,
    particle: {
      count: 5,
      style: 'circle',
    },
  },
  ending: {
    grades: ['A', 'B', 'C', 'F', 'Phi', 'S', 'V-FC', 'V'].map((name) => {
      return {
        name,
        file: `${base}/game/grades/${name}.png`,
      };
    }),
    music: [0, 1, 2, 3, 4].map((levelType) => {
      return {
        levelType: levelType as LevelType,
        beats: 64,
        bpm: 140,
        file: `${base}/game/ending/LevelOver${levelType}.wav`,
      };
    }),
  },
  fonts: [
    ...['Outfit', 'NotoSansSC'].map((name) => {
      return {
        name,
        type: 'truetype',
        file: `${base}/fonts/${name}/${name}.ttf`,
      };
    }),
    {
      name: 'Outfit',
      type: 'bitmap',
      texture: `${base}/fonts/Outfit/Outfit.png`,
      descriptor: `${base}/fonts/Outfit/Outfit.fnt`,
    },
  ],
};
