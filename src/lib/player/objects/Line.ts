import { GameObjects, Math as PhaserMath } from 'phaser';
import {
  type AlphaControl,
  type ColorEvent,
  type Event,
  type GifEvent,
  type JudgeLine,
  type PosControl,
  type SizeControl,
  type SkewControl,
  type SpeedEvent,
  type TextEvent,
  type YControl,
} from '$lib/types';
import { LongNote } from './LongNote';
import { PlainNote } from './PlainNote';
import {
  getIntegral,
  getLineColor,
  getEventValue,
  processEvents,
  rgbToHex,
  toBeats,
  processControlNodes,
  isEqual,
  sanitizeEasedProgress,
} from '../utils';
import type { Game } from '../scenes/Game';
import { NOTE_BASE_SIZE } from '../constants';
import { dot } from 'mathjs';
import type { Video } from './Video';
import { isDebug } from '$lib/utils';

/**
 * Per-frame values shared between a line and its notes.
 * Reused (not re-allocated) each frame to keep the hot path allocation-free.
 */
export interface LineFrameCtx {
  px: number; // canvas.width / 1350
  ox: number; // canvas.height / 900
  dScale: number; // canvas.height * 2 / 15
  cullBound: number;
  lineOpacity: number;
  lineIncline: number | undefined;
  isCover: boolean;
  alphaControl: AlphaControl[];
  posControl: PosControl[];
  sizeControl: SizeControl[];
  skewControl: SkewControl[];
  yControl: YControl[];
  /** 900 / canvas.height — converts pixel distance back to chart units. */
  invHeight900: number;
  /** Math.cos(line.rotation) for the current frame. */
  cosRotation: number;
  /** World Y of the judge line for the current frame. */
  lineY: number;
  /** canvas.height / 2. */
  centerY: number;
  /** Song time for the current frame (equals the `songTime` argument). */
  timeSec: number;
}

const EMPTY_CTRL: [AlphaControl[], PosControl[], SizeControl[], SkewControl[], YControl[]] = [
  [],
  [],
  [],
  [],
  [],
];

/**
 * Hot per-frame evaluation of one numeric event list (alpha/moveX/moveY/
 * rotate) for a single layer. Advances the layer's event cursor in amortized
 * O(1) and returns the interpolated value, or 0 when the list is empty
 * (equivalent to the previous `undefined` skip in the caller's sum).
 */
const evalEvents = (
  events: Event[] | null | undefined,
  cur: number[],
  pre: number[],
  post: number[],
  idx: number,
  beat: number,
  timeSec: number,
): number => {
  if (!events || events.length === 0) return 0;
  const last = events.length - 1;
  let ci = cur[idx];
  if (ci > last) ci = last;
  if (ci > 0 && beat <= events[ci].startBeat) ci = 0;
  while (ci < last && beat > events[ci + 1].startBeat) ci++;
  cur[idx] = ci;
  // Boundary fast paths: a list whose active span lies wholly ahead of or
  // behind the current beat evaluates to a time-independent constant (the
  // start of its first / end of its last event), so interpolate nothing and
  // reuse the cached value until a rewind invalidates the cursor state.
  // Most lists on event-heavy charts sit outside their span at any moment,
  // so this removes nearly all per-frame interpolation work.
  if (beat < events[0].startBeat) {
    if (Number.isNaN(pre[idx])) {
      const raw = getEventValue(events[0], timeSec);
      pre[idx] = typeof raw === 'number' ? raw : 0;
    }
    return pre[idx];
  }
  const endBeat = events[last].endBeat;
  if (endBeat !== undefined && beat >= endBeat) {
    if (Number.isNaN(post[idx])) {
      const raw = getEventValue(events[last], timeSec);
      post[idx] = typeof raw === 'number' ? raw : 0;
    }
    return post[idx];
  }
  // Active segment. Dispatch inline instead of through getEventValue — this
  // runs for every interior list on every frame, and event-heavy charts keep
  // most lists interior throughout playback.
  const ev = events[ci];
  let x = (timeSec - ev.startTimeSec!) / (ev.endTimeSec! - ev.startTimeSec!);
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  const easingType = ev.easingType;
  if (easingType === 1 && ev.bezier !== 1) {
    // Identity ease: the value is a direct lerp of the endpoints.
    return ev.start + (ev.end - ev.start) * x;
  }
  if (easingType > 1) {
    // Eased segment: sample the (load-time) easing table instead of calling
    // the easing closure per frame.
    const lut = ev.__lut;
    if (lut !== undefined && ev.__pe !== ev.__ps) {
      const t = x * (lut.length - 1);
      const i0 = t | 0;
      const f0 = lut[i0];
      const raw = i0 >= lut.length - 1 ? f0 : f0 + (lut[i0 + 1] - f0) * (t - i0);
      // Normalize the sampled value to a lerp progress, snapping only the
      // float32/float64 endpoint epsilon (see sanitizeEasedProgress). A hard
      // clamp here would flatten legitimate back/elastic overshoot (e.g.
      // easeOutBack reaches ~1.1 mid-segment), which is what makes those
      // segments look linear then frozen at the end value.
      const progress = sanitizeEasedProgress(raw, ev.__ps!, ev.__pe!);
      return ev.start + (ev.end - ev.start) * progress;
    }
  }
  const value = getEventValue(ev, timeSec);
  // Numeric event lists normally always yield numbers; the type check simply
  // preserves the previous behavior of skipping undefined results.
  return typeof value === 'number' ? value : 0;
};

export class Line {
  private _scene: Game;
  private _index: number;
  private _data: JudgeLine;
  private _line: GameObjects.Image | GameObjects.Sprite | GameObjects.Text;
  private _parent: Line | null = null;
  private _noteContainers: Record<number, GameObjects.Container> = {};
  private _noteContainersArr: GameObjects.Container[] = [];
  private _noteMask: GameObjects.Rectangle | null = null;
  private _notes: (PlainNote | LongNote)[] = [];
  private _noteCullBound: number = Infinity;
  private _noteWindowCursor: number = 0;
  /**
   * Per-note visual-window start times (`hitTime - visibleTime`), used to
   * binary-search the first not-yet-visible note each frame. Built once when
   * the line's notes are complete; left null when the starts are not sorted
   * ascending (rare), in which case the scan falls back to a full walk.
   */
  private _noteWindowStarts: number[] | null = null;
  private _hasAttach: boolean = false;
  private _hasCustomTexture: boolean = false;
  private _hasAnimatedTexture: boolean = false;
  private _hasText: boolean = false;
  private _xModifier: 1 | -1 = 1;
  private _yModifier: 1 | -1 = 1;
  private _rotationModifier: 1 | -1 = 1;
  private _rotationOffset: 0 | 180 = 0;
  private _rotateWithParent: boolean = false;
  private _integrateSpeedEasings: boolean = false;

  private _curX: number[] = [];
  private _curY: number[] = [];
  private _curRot: number[] = [];
  private _curAlpha: number[] = [];
  private _curSpeed: number[] = [];
  private _lastHeight: number[] = [];

  /** Per-list cached values before the first / after the last event. */
  private _preX: number[] = [];
  private _postX: number[] = [];
  private _preY: number[] = [];
  private _postY: number[] = [];
  private _preRot: number[] = [];
  private _postRot: number[] = [];
  private _preAlpha: number[] = [];
  private _postAlpha: number[] = [];

  private _curColor: number[] = [];
  private _curGif: number[] = [];
  private _curIncline: number[] = [];
  private _curScaleX: number[] = [];
  private _curScaleY: number[] = [];
  private _curText: number[] = [];

  private _ctrlCache = new Map<
    number,
    [AlphaControl[], PosControl[], SizeControl[], SkewControl[], YControl[]]
  >();

  private _opacity: number = 0;
  private _x: number = 0;
  private _y: number = 0;
  private _rotation: number = 0;
  private _color: number[] | undefined = undefined;
  private _gif: number | undefined = undefined;
  private _incline: number | undefined = undefined;
  private _scaleX: number | undefined = undefined;
  private _scaleY: number | undefined = undefined;
  private _text: string | undefined = undefined;
  private _textScale: number;
  private _font: string | undefined = undefined;
  private _appliedFont: string | undefined = undefined;
  private _height: number = 0;
  /** Line-space beat and song time of the last processed update pass. */
  private _lastLineBeat: number = NaN;
  private _lastSongTime: number = NaN;

  private _attachedVideos: Video[] = [];

  private _debug: GameObjects.Container | undefined = undefined;
  private _selfDebug: GameObjects.Container | undefined = undefined;

  private _posX: number = 0;
  private _posY: number = 0;

  private _frameCtx: LineFrameCtx = {
    px: 0,
    ox: 0,
    dScale: 0,
    cullBound: 0,
    lineOpacity: 0,
    lineIncline: undefined,
    isCover: false,
    alphaControl: [],
    posControl: [],
    sizeControl: [],
    skewControl: [],
    yControl: [],
    invHeight900: 0,
    cosRotation: 1,
    lineY: 0,
    centerY: 0,
    timeSec: 0,
  };

  constructor(
    scene: Game,
    lineData: JudgeLine,
    num: number,
    precedence: number,
    highlightMoments: [number, number, number][],
  ) {
    this._scene = scene;
    this._index = num;
    this._data = lineData;
    this._hasText = (this._data.extended?.textEvents?.length ?? 0) > 0;
    this._hasCustomTexture = this._hasText || lineData.Texture !== 'line.png';
    this._hasAnimatedTexture =
      ['.gif', '.apng'].some((e) => lineData.Texture.toLowerCase().endsWith(e)) &&
      this._scene.textures.exists(`asset-${lineData.Texture}`);
    this._textScale = this._scene.p(100);
    this._line = this._hasText
      ? new GameObjects.Text(scene, 0, 0, this._text ?? '', {
          fontFamily: scene.getFont(this._font),
          fontSize: this._textScale,
          color: '#ffffff',
          align: 'left',
        }).setOrigin(0.5)
      : this._hasAnimatedTexture
        ? new GameObjects.Sprite(scene, 0, 0, `asset-${lineData.Texture}`).play(
            `asset-${lineData.Texture}`,
          )
        : new GameObjects.Image(scene, 0, 0, this.getLineTexture(`asset-${lineData.Texture}`));

    this._hasAttach = !!this._data.attachUI;
    this._rotateWithParent = this._data.rotateWithFather ?? false;
    this._integrateSpeedEasings =
      this._data.integrateSpeedEasings ?? this._scene.chart.META.RPEVersion >= 170;
    this._line.setScale(
      (this._hasText ? this._scene.p(50) / this._textScale : this._scene.p(1)) *
        (this._scaleX ?? 1),
      this._hasCustomTexture
        ? (this._hasText ? this._scene.p(50) / this._textScale : this._scene.p(1)) *
            (this._scaleY ?? 1)
        : this._scene.o(1) * this._scene.preferences.lineThickness * (this._scaleY ?? 1.35),
    ); // previously 1.0125 (according to the official definition that a line is 3 times as wide as the screen)
    this._line.setDepth(lineData.zIndex !== undefined ? lineData.zIndex : 2 + precedence);
    this._line.setVisible(!this._hasAttach || !!lineData.appearanceOnAttach || this._hasText);
    if (!this._hasCustomTexture && (!this._hasAttach || lineData.appearanceOnAttach === 2))
      this._line.setTint(getLineColor(scene));
    if (this._data.anchor) this._line.setOrigin(this._data.anchor[0], 1 - this._data.anchor[1]);

    if (scene.preferences.chartFlipping & 1) {
      this._xModifier = -1;
      this._rotationModifier = -1;
    }
    if (scene.preferences.chartFlipping & 2) {
      this._yModifier = -1;
      this._rotationModifier = (-1 * this._xModifier) as 1 | -1;
      this._rotationOffset = 180;
    }

    this.setVisible(false);
    scene.registerNode(this._line, `line-${num}`);

    this._data.eventLayers.forEach((layer, i) => {
      processEvents(layer?.alphaEvents, this._scene.timeUtil, i, this._index);
      processEvents(layer?.moveXEvents, this._scene.timeUtil, i, this._index);
      processEvents(layer?.moveYEvents, this._scene.timeUtil, i, this._index);
      processEvents(layer?.rotateEvents, this._scene.timeUtil, i, this._index);
      processEvents(layer?.speedEvents, this._scene.timeUtil, i, this._index);
    });

    if (this._data.extended) {
      processEvents(this._data.extended.colorEvents, this._scene.timeUtil, 'Extended', this._index);
      processEvents(this._data.extended.gifEvents, this._scene.timeUtil, 'Extended', this._index);
      processEvents(
        this._data.extended.inclineEvents,
        this._scene.timeUtil,
        'Extended',
        this._index,
      );
      processEvents(
        this._data.extended.scaleXEvents,
        this._scene.timeUtil,
        'Extended',
        this._index,
      );
      processEvents(
        this._data.extended.scaleYEvents,
        this._scene.timeUtil,
        'Extended',
        this._index,
      );
      processEvents(this._data.extended.textEvents, this._scene.timeUtil, 'Extended', this._index);
    }

    processControlNodes(this._data.alphaControl);
    processControlNodes(this._data.posControl);
    processControlNodes(this._data.sizeControl);
    processControlNodes(this._data.skewControl);
    processControlNodes(this._data.yControl);
    // Cache per-frame control arrays so the hot note-update path doesn't
    // re-look-up and re-bind them on every note every frame.
    this._ctrlCache.set(num, [
      this._data.alphaControl ?? [],
      this._data.posControl ?? [],
      this._data.sizeControl ?? [],
      this._data.skewControl ?? [],
      this._data.yControl ?? [],
    ]);

    if (isDebug()) {
      this._debug = this.createContainer(Infinity);
      this._selfDebug = new GameObjects.Container(scene)
        .add(scene.add.rectangle(0, 0, 40, 40, 0x00ff00).setOrigin(0.5))
        .add(
          scene.add
            .text(0, 60, num.toString(), {
              fontFamily: 'Outfit',
              fontSize: 80,
              color: '#e2e2e2',
              align: 'center',
            })
            .setOrigin(0.5),
        );
      this._debug.add(this._selfDebug);
    }

    if (this._data.notes) {
      this._data.notes.forEach((note) => {
        note.startBeat = toBeats(note.startTime);
        note.endBeat = toBeats(note.endTime);
        note.judgeSize ??= note.size;
      });
      this._data.notes.sort((a, b) => a.startBeat - b.startBeat);
      this._data.notes.forEach((data, i) => {
        let note: PlainNote | LongNote;
        const highlight = highlightMoments.some((moment) => isEqual(moment, data.startTime));
        if (data.type === 2) {
          note = new LongNote(scene, data, i, highlight);
          note.setHeadHeight(this.calculateHeight(data.startBeat));
          note.setTailHeight(this.calculateHeight(data.endBeat));
        } else {
          note = new PlainNote(scene, data, i, highlight);
          note.setHeight(this.calculateHeight(data.startBeat));
        }
        this.addNote(note, this._noteContainers[note.zIndex] ?? this.createContainer(note.zIndex));
      });

      if (lineData.scaleOnNotes === 2) {
        this._noteMask = new GameObjects.Rectangle(scene, 0, 0, 1, 1, 0xffffff, 1);
        Object.values(this._noteContainers).forEach((container) => {
          container
            .enableFilters()
            .filters!.internal.addMask(this._noteMask!, false, this._scene.cameras.main, 'world');
        });
      }
    }

    // calculateHeight() uses the same incremental event cursors as playback.
    // Do not leave those cursors at the last note's position when the first
    // frame is rendered (or after a seek); playback must rebuild them from 0.
    this.resetEventState();
    this.buildNoteWindowIndex();
  }

  private buildNoteWindowIndex() {
    const notes = this._notes;
    const starts = new Array<number>(notes.length);
    let sorted = true;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const start = note.hitTime - note.note.visibleTime;
      // NaN (missing visibleTime) or decreasing starts disqualify the fast
      // binary-search bound; the scan then falls back to per-note checks,
      // which reproduce the legacy behavior exactly.
      if (!Number.isFinite(start) || (i > 0 && start < starts[i - 1])) sorted = false;
      starts[i] = start;
    }
    this._noteWindowStarts = sorted ? starts : null;
  }

  update(beat: number, songTime: number, gameTime: number, forceFullNoteUpdate: boolean = false) {
    const lineBeat = beat / this._data.bpmfactor;
    // Skip the whole pass when nothing observable changed — most importantly
    // while paused, where the previous per-frame guard (gameTime) still
    // advanced and forced a full recomputation of identical values.
    if (!forceFullNoteUpdate && lineBeat === this._lastLineBeat && songTime === this._lastSongTime)
      return;
    this._lastLineBeat = lineBeat;
    this._lastSongTime = songTime;
    if (forceFullNoteUpdate) this.resetEventState();
    this._parent?.update(beat, songTime, gameTime, forceFullNoteUpdate);
    const timeSec = this._scene.timeUtil.getTimeSec(lineBeat);
    this.handleEventLayers(lineBeat, timeSec);
    this.updateParams();
    this._noteCullBound =
      this._scene.sys.canvas.height +
      (this._scene.sys.canvas.width / 2) * Math.abs(Math.sin(this._line.rotation));
    if (forceFullNoteUpdate) {
      this._notes.forEach((note) => {
        note.update(lineBeat, songTime, this._height);
      });
      return;
    }
    this.updateVisibleNotes(lineBeat, songTime);
  }

  /**
   * Advances the note window cursor past notes whose visual window has fully
   * elapsed. The notes are sorted by start beat; `visualEndTime` is at least
   * one second after the note's (hold) end, so any note whose end has passed
   * can never become visible again. The remainder of the loop still guards
   * against the (rare) non-monotonic long-note interleaving case with an
   * explicit expiry check, so this only skips the already-passed prefix.
   */
  private advanceNoteCursor(songTime: number) {
    const notes = this._notes;
    let i = this._noteWindowCursor;
    while (i < notes.length && notes[i].visualEndTime <= songTime) {
      if (notes[i].visible) notes[i].setVisible(false);
      i++;
    }
    this._noteWindowCursor = i;
  }

  updateVisibleNotes(beat: number, songTime: number) {
    this.advanceNoteCursor(songTime);
    const notes = this._notes;
    // Upper bound: first note whose visual window has not started yet. Notes
    // beyond it are guaranteed invisible this frame, so the previous
    // full-walk-to-end (which touched every future note of every line, every
    // frame) collapses to a binary search plus only the active window.
    let end = notes.length;
    const starts = this._noteWindowStarts;
    if (starts !== null) {
      let lo = this._noteWindowCursor;
      let hi = end;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (starts[mid] <= songTime) lo = mid + 1;
        else hi = mid;
      }
      end = lo;
      // No candidate notes this frame — skip the entire per-line ctx setup
      // (trig, scales, control lookups), which otherwise runs for all 741
      // lines every frame even though most have nothing in window.
      if (end <= this._noteWindowCursor) return;
    }
    const ctx = this._frameCtx;
    const canvasHeight = this._scene.sys.canvas.height;
    const canvasWidth = this._scene.sys.canvas.width;
    ctx.px = canvasWidth / 1350;
    ctx.ox = canvasHeight / 900;
    ctx.dScale = (canvasHeight * 2) / 15;
    ctx.invHeight900 = 900 / canvasHeight;
    ctx.cullBound = this._noteCullBound;
    ctx.lineOpacity = this._opacity;
    ctx.lineIncline = this._incline;
    ctx.isCover = !!this._data.isCover;
    ctx.cosRotation = Math.cos(this._line.rotation);
    ctx.lineY = this._line.y;
    ctx.centerY = canvasHeight / 2;
    ctx.timeSec = songTime;
    const ctrl = this._ctrlCache.get(this._index);
    ctx.alphaControl = ctrl?.[0] ?? EMPTY_CTRL[0];
    ctx.posControl = ctrl?.[1] ?? EMPTY_CTRL[1];
    ctx.sizeControl = ctrl?.[2] ?? EMPTY_CTRL[2];
    ctx.skewControl = ctrl?.[3] ?? EMPTY_CTRL[3];
    ctx.yControl = ctrl?.[4] ?? EMPTY_CTRL[4];
    if (starts !== null) {
      for (let i = this._noteWindowCursor; i < end; i++) {
        const note = notes[i];
        // Expiry guard for the (rare) non-monotonic long-note interleaving
        // case that neither cursor could skip.
        if (note.visualEndTime <= songTime) {
          if (note.visible) note.setVisible(false);
          continue;
        }
        if (!this.isNoteInCullArea(note, ctx)) {
          if (note.visible) note.setVisible(false);
          continue;
        }
        note.update(beat, songTime, this._height, ctx);
      }
    } else {
      // Unsorted window starts (rare): fall back to explicit per-note checks.
      for (let i = this._noteWindowCursor; i < notes.length; i++) {
        const note = notes[i];
        if (
          note.visualEndTime <= songTime ||
          songTime < note.hitTime - note.note.visibleTime ||
          !this.isNoteInCullArea(note, ctx)
        ) {
          if (note.visible) note.setVisible(false);
          continue;
        }
        note.update(beat, songTime, this._height, ctx);
      }
    }
  }

  resetActiveNoteWindow() {
    // Kept for Game's seek reset path. Note eligibility is now derived from
    // absolute time, so there is no cursor or active-note list to rebuild —
    // only the visual-window cursor needs rewinding to the start.
    this._noteWindowCursor = 0;
    this._lastLineBeat = NaN;
    this._lastSongTime = NaN;
  }

  /**
   * Forces the next update pass to run even if beat and song time are
   * unchanged. Used while the in() entrance tween is driving element alphas
   * directly: updateParams must keep re-applying each line's evaluated
   * opacity against the tween's writes, exactly like the pre-skip behavior.
   */
  invalidate() {
    this._lastLineBeat = NaN;
    this._lastSongTime = NaN;
  }

  private resetEventState() {
    this._curX = [];
    this._curY = [];
    this._curRot = [];
    this._curAlpha = [];
    this._curSpeed = [];
    this._lastHeight = [];
    this._preX = [];
    this._postX = [];
    this._preY = [];
    this._postY = [];
    this._preRot = [];
    this._postRot = [];
    this._preAlpha = [];
    this._postAlpha = [];
    this._curColor = [];
    this._curGif = [];
    this._curIncline = [];
    this._curScaleX = [];
    this._curScaleY = [];
    this._curText = [];
  }

  private isNoteInCullArea(note: PlainNote | LongNote, ctx: LineFrameCtx) {
    // All frame-constant values (trig, scales, bounds) are hoisted into the
    // per-line ctx; previously this recomputed them for every note, every
    // frame, which profiled as one of the hottest functions in the game.
    const yModifier = note.note.above === 1 ? -1 : 1;
    const speed = note.note.speed;
    const lineY = ctx.lineY;
    const cosRotation = ctx.cosRotation;
    const centerY = ctx.centerY;
    const cullBound = ctx.cullBound;
    const height = this._height;
    const yOffset = note.note.yOffset;

    if (note.isHold) {
      // Once a hold reaches the judgment line, its endpoints can both be
      // outside the viewport while its body is still crossing the line. Keep
      // updating it for the complete judgment interval in that case.
      if (ctx.timeSec >= note.hitTime && ctx.timeSec <= note.endHitTime) {
        return true;
      }

      const headY =
        lineY +
        yModifier *
          ((note.headTargetHeight - height) * speed * ctx.dScale + yOffset * ctx.ox) *
          cosRotation;
      const tailY =
        lineY +
        yModifier *
          ((note.tailTargetHeight - height) * speed * ctx.dScale + yOffset * ctx.ox) *
          cosRotation;
      const minY = Math.min(headY, tailY);
      const maxY = Math.max(headY, tailY);
      return maxY >= centerY - cullBound && minY <= centerY + cullBound;
    }
    const y =
      lineY +
      yModifier *
        ((note.targetHeight - height) * speed * ctx.dScale + yOffset * ctx.ox) *
        cosRotation;
    return Math.abs(y - centerY) <= cullBound;
  }

  destroy() {
    this._line.destroy();
    this._noteMask?.destroy();
    this._noteContainersArr.forEach((container) => {
      container.destroy();
    });
    this._notes.forEach((note) => {
      note.destroy();
    });
  }

  updateParams() {
    const line = this._line;
    const baseScale = this._hasText ? this._scene.p(50) / this._textScale : this._scene.p(1);
    const scaleX = baseScale * (this._scaleX ?? 1);
    const scaleY = this._hasCustomTexture
      ? baseScale * (this._scaleY ?? 1)
      : this._scene.o(1) * this._scene.preferences.lineThickness * (this._scaleY ?? 1.35);
    // NOTE: every property below is compared against its live value before
    // being written, so static lines skip the setter entirely (each of which
    // dirties transform/render state in Phaser). The alpha comparison also
    // keeps the in()/out() tweens working: they write `alpha` directly
    // between our writes, which makes the live value diverge from ours and
    // forces a re-apply — exactly the behavior the previous unconditional
    // write produced.
    if (line.scaleX !== scaleX || line.scaleY !== scaleY) line.setScale(scaleX, scaleY);
    if (this._hasText) {
      const textObj = line as GameObjects.Text;
      textObj.setText(this._text ?? '');
      const fontFamily = this._scene.getFont(this._font);
      if (this._appliedFont !== fontFamily) {
        textObj.setFontFamily(fontFamily);
        this._appliedFont = fontFamily;
      }
    }
    if (this._hasAnimatedTexture) {
      const sprite = line as GameObjects.Sprite;
      if (this._gif !== undefined && this._gif >= 0 && this._gif <= 1) {
        sprite.anims.pause();
        sprite.anims.setProgress(this._gif);
      } else if (sprite.anims?.isPaused) {
        sprite.anims.resume();
      }
    }
    let tint: number | undefined;
    if (this._color !== undefined) tint = rgbToHex(this._color);
    else if (!this._hasCustomTexture && (!this._hasAttach || this._data.appearanceOnAttach === 2))
      tint = getLineColor(this._scene);
    if (tint !== undefined && line.tint !== tint) line.setTint(tint);
    this.getPosition();
    const rotation = this.getRotation();
    if (line.x !== this._posX || line.y !== this._posY) line.setPosition(this._posX, this._posY);
    if (line.rotation !== rotation) line.setRotation(rotation);
    const targetAlpha = this._opacity / 255;
    // Fully transparent lines are excluded from the render list entirely —
    // event-heavy charts keep the vast majority of their lines at opacity 0
    // at any moment, and Phaser otherwise still traverses and builds commands
    // for every one of them each frame.
    const visible = targetAlpha > 0;
    if (line.visible !== visible) line.setVisible(visible);
    if (line.alpha !== targetAlpha) line.setAlpha(targetAlpha);
    const x = this._posX;
    const y = this._posY;
    const containers = this._noteContainersArr;
    for (let i = 0; i < containers.length; i++) {
      const obj = containers[i];
      if (obj.x !== x || obj.y !== y) obj.setPosition(x, y);
      if (obj.rotation !== rotation) obj.setRotation(rotation);
      if (this._data.scaleOnNotes === 1) {
        if (obj.scaleX !== (this._scaleX ?? 1)) obj.setScale(this._scaleX ?? 1, 1);
      }
    }
    if (this._noteMask !== null) this.updateMask();
    this.updateAttachments();

    if (this._selfDebug) {
      this._selfDebug.setVisible(
        this._notes.findIndex(
          (note) =>
            Math.abs(note.x) < this._scene.p(20) && Math.abs(note.floor) < this._scene.o(20),
        ) === -1,
      );
      this._selfDebug.setScale(this._scene.p(1.4 * NOTE_BASE_SIZE));
    }
  }

  updateAttachments() {
    // Fast path: no UI or video attachments on this line — nothing to do.
    // (The common case for high-note-count stress charts.)
    if (!this._hasAttach && this._attachedVideos.length === 0) return;
    const params = {
      x: this._line.x - this._scene.sys.canvas.width / 2,
      y: this._line.y - this._scene.sys.canvas.height / 2,
      rotation: this._line.rotation,
      alpha: this._line.alpha,
      scaleX: this._scaleX ?? 1,
      scaleY: this._scaleY ?? 1,
      tint: this._line.tint,
    };
    this.updateUIAttachments(params);
    this.updateAttachedVideos(params);
  }

  updateUIAttachments(params: {
    x: number;
    y: number;
    rotation: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
    tint: number;
  }) {
    if (this._data.attachUI) {
      switch (this._data.attachUI) {
        case 'pause': {
          this._scene.gameUI.pause.setAttach(params);
          return;
        }
        case 'combonumber': {
          this._scene.gameUI.combo.updateAttach(params, true);
          return;
        }
        case 'combo': {
          this._scene.gameUI.comboText.updateAttach(params, true);
          return;
        }
        case 'score': {
          this._scene.gameUI.score.updateAttach(params);
          this._scene.gameUI.accuracy?.updateAttach(params);
          return;
        }
        case 'bar': {
          this._scene.gameUI.progressBar.setAttach(params);
          return;
        }
        case 'name': {
          this._scene.gameUI.songTitle.updateAttach(params);
          return;
        }
        case 'level': {
          this._scene.gameUI.level.updateAttach(params);
          return;
        }
      }
    }
  }

  updateAttachedVideos(params: {
    x: number;
    y: number;
    rotation: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
    tint: number;
  }) {
    this._attachedVideos.forEach((video) => {
      video.updateAttach({ ...params, width: this._line.displayWidth });
    });
  }

  /**
   * Computes the line's world position for the current frame and stores it in
   * `_posX`/`_posY` (previously allocated a fresh `{x, y}` per call, which
   * ran once per line per frame).
   */
  getPosition() {
    const halfScreenWidth = this._scene.sys.canvas.width / 2;
    const halfScreenHeight = this._scene.sys.canvas.height / 2;
    const x = this._scene.p(this._xModifier * this._x);
    const y = this._scene.o(-this._yModifier * this._y);
    if (this._parent !== null) {
      const parentX = this._parent.x - halfScreenWidth;
      const parentY = this._parent.y - halfScreenHeight;
      const cos = Math.cos(this._parent.rotation);
      const sin = Math.sin(this._parent.rotation);
      this._posX = parentX + x * cos - y * sin + halfScreenWidth;
      this._posY = parentY + y * cos + x * sin + halfScreenHeight;
      return;
    }
    this._posX = x + halfScreenWidth;
    this._posY = y + halfScreenHeight;
  }

  getRotation() {
    let rotation = this._rotationModifier * this._rotation + this._rotationOffset;
    rotation *= Math.PI / 180;
    if (this._parent !== null && this._rotateWithParent) {
      rotation += this._parent.rotation;
    }
    return rotation;
  }

  createContainer(depth: number) {
    const container = new GameObjects.Container(this._scene);
    container.setDepth(depth);
    this._noteContainers[depth] = container;
    this._noteContainersArr.push(container);
    this._scene.registerNode(container, `line-${this._index}-cont-${depth}`);
    return container;
  }

  handleEventLayers(beat: number, timeSec: number) {
    let alpha = 0;
    let x = 0;
    let y = 0;
    let rotation = 0;
    let height = 0;
    // Zero-fill cursor arrays up front so the per-layer event evaluations
    // don't each re-check `while (cur.length < layerIndex + 1) cur.push(0)`.
    const data = this._data;
    const layers = data.eventLayers;
    const layerCount = layers.length;
    const curAlpha = this._curAlpha;
    const curX = this._curX;
    const curY = this._curY;
    const curRot = this._curRot;
    const curSpeed = this._curSpeed;
    const curHeight = this._lastHeight;
    const preAlpha = this._preAlpha;
    const postAlpha = this._postAlpha;
    const preX = this._preX;
    const postX = this._postX;
    const preY = this._preY;
    const postY = this._postY;
    const preRot = this._preRot;
    const postRot = this._postRot;
    for (let i = curAlpha.length; i <= layerCount; i++) {
      curAlpha.push(0);
      preAlpha.push(NaN);
      postAlpha.push(NaN);
      curX.push(0);
      preX.push(NaN);
      postX.push(NaN);
      curY.push(0);
      preY.push(NaN);
      postY.push(NaN);
      curRot.push(0);
      preRot.push(NaN);
      postRot.push(NaN);
      curSpeed.push(0);
      curHeight.push(0);
    }
    for (let i = 0; i < layerCount; i++) {
      const layer = layers[i];
      if (!layer) continue;
      alpha += evalEvents(layer.alphaEvents, curAlpha, preAlpha, postAlpha, i, beat, timeSec);
      x += evalEvents(layer.moveXEvents, curX, preX, postX, i, beat, timeSec);
      y += evalEvents(layer.moveYEvents, curY, preY, postY, i, beat, timeSec);
      rotation += evalEvents(layer.rotateEvents, curRot, preRot, postRot, i, beat, timeSec);
      height += this.handleSpeed(beat, i, layer.speedEvents, curSpeed, curHeight, timeSec);
    }
    this._opacity = alpha;
    this._x = x;
    this._y = y;
    this._rotation = rotation;
    this._height = height;
    this.handleExtendedEvent(beat, 0, timeSec);
  }

  /**
   * In-place variant of handleExtendedEventLayer that writes into the line's
   * state fields directly — avoiding a per-layer allocation of the result
   * object. `handleEventLayers` calls this once per frame with layerIndex 0.
   */
  handleExtendedEvent(beat: number, layerIndex: number, timeSec: number) {
    const extended = this._data.extended;
    if (extended) {
      const text = this.handleEvent(
        beat,
        layerIndex,
        extended.textEvents,
        this._curText,
        timeSec,
      ) as string | undefined;
      const font = extended.textEvents?.[this._curText[layerIndex]]?.font;
      this._color = this.handleEvent(
        beat,
        layerIndex,
        extended.colorEvents,
        this._curColor,
        timeSec,
      ) as number[] | undefined;
      this._gif = this.handleEvent(
        beat,
        layerIndex,
        extended.gifEvents,
        this._curGif,
        timeSec,
        false,
      ) as number | undefined;
      this._incline = this.handleEvent(
        beat,
        layerIndex,
        extended.inclineEvents,
        this._curIncline,
        timeSec,
      ) as number | undefined;
      this._scaleX = this.handleEvent(
        beat,
        layerIndex,
        extended.scaleXEvents,
        this._curScaleX,
        timeSec,
      ) as number | undefined;
      this._scaleY = this.handleEvent(
        beat,
        layerIndex,
        extended.scaleYEvents,
        this._curScaleY,
        timeSec,
      ) as number | undefined;
      this._text = text;
      this._font = font;
    } else {
      this._color = undefined;
      this._gif = undefined;
      this._incline = undefined;
      this._scaleX = undefined;
      this._scaleY = undefined;
      this._text = undefined;
      this._font = undefined;
    }
  }

  handleSpeed(
    beat: number,
    layerIndex: number,
    events: SpeedEvent[] | null | undefined,
    cur: number[],
    lastHeight: number[],
    timeSec: number,
  ) {
    while (cur.length < layerIndex + 1) cur.push(0);
    while (lastHeight.length < layerIndex + 1) lastHeight.push(0);
    if (events && events.length > 0) {
      if (cur[layerIndex] > 0 && beat <= events[cur[layerIndex]].startBeat) {
        cur[layerIndex] = 0;
        lastHeight[layerIndex] = 0;
      }
      while (cur[layerIndex] < events.length - 1 && beat > events[cur[layerIndex] + 1].startBeat) {
        lastHeight[layerIndex] +=
          getIntegral(events[cur[layerIndex]], this._integrateSpeedEasings) +
          events[cur[layerIndex]].end *
            (events[cur[layerIndex] + 1].startTimeSec! - events[cur[layerIndex]].endTimeSec!);
        cur[layerIndex]++;
      }
      let height = lastHeight[layerIndex];
      if (beat <= events[cur[layerIndex]].endBeat) {
        height += getIntegral(events[cur[layerIndex]], this._integrateSpeedEasings, beat, timeSec);
      } else {
        height +=
          getIntegral(events[cur[layerIndex]], this._integrateSpeedEasings) +
          events[cur[layerIndex]].end * (timeSec - events[cur[layerIndex]].endTimeSec!);
      }
      return height;
    } else {
      return 0;
    }
  }

  handleEvent(
    beat: number,
    layerIndex: number,
    events: (Event | ColorEvent | GifEvent | TextEvent)[] | null | undefined,
    cur: number[],
    timeSec: number,
    fillInBetween = true,
  ) {
    while (cur.length < layerIndex + 1) {
      cur.push(0);
    }
    if (events && events.length > 0) {
      if (cur[layerIndex] > 0 && beat <= events[cur[layerIndex]].startBeat) {
        cur[layerIndex] = 0;
      }
      while (cur[layerIndex] < events.length - 1 && beat > events[cur[layerIndex] + 1].startBeat) {
        cur[layerIndex]++;
      }
      if (
        !fillInBetween &&
        (beat <= events[cur[layerIndex]].startBeat || beat > events[cur[layerIndex]].endBeat)
      ) {
        return undefined;
      }
      return getEventValue(events[cur[layerIndex]], timeSec);
    } else {
      return undefined;
    }
  }

  updateMask() {
    if (this._noteMask === null) return;
    const halfScreenWidth = this._scene.sys.canvas.width / 2;
    const halfScreenHeight = this._scene.sys.canvas.height / 2;
    const vector = this.vector;
    vector.scale(dot([this.x - halfScreenWidth, this.y - halfScreenHeight], [vector.x, vector.y]));
    vector.add(new PhaserMath.Vector2(halfScreenWidth, halfScreenHeight));
    this._noteMask.setPosition(vector.x, vector.y);
    this._noteMask.setRotation(this._line.rotation);
    const rectWidth = this._line.displayWidth;
    const rectHeight = this._scene.sys.canvas.width ** 2 + this._scene.sys.canvas.height ** 2;
    this._noteMask.setSize(rectWidth, rectHeight);
  }

  calculateHeight(beat: number) {
    const timeSec = this._scene.timeUtil.getTimeSec(beat);
    return this._data.eventLayers.reduce(
      (acc, layer, i) =>
        acc +
        this.handleSpeed(beat, i, layer?.speedEvents, this._curSpeed, this._lastHeight, timeSec),
      0,
    );
  }

  addNote(note: PlainNote | LongNote, container: GameObjects.Container) {
    note.line = this;
    this._notes.push(note);
    container.add(note);
  }

  setParent(parent: Line) {
    this._parent = parent;
  }

  getLineTexture(key: string) {
    return this._scene.textures.exists(key) ? key : 'asset-line.png';
  }

  attachVideo(video: Video) {
    this._attachedVideos.push(video);
    this._hasAttach = true;
    this._line.clearTint();
    this._line.setVisible(!!this._data.appearanceOnAttach || this._hasText);
  }

  public get notes() {
    return this._notes;
  }

  public get data() {
    return this._data;
  }

  public get x() {
    return this._line.x;
  }

  public get y() {
    return this._line.y;
  }

  public get rotation() {
    return this._line.rotation;
  }

  public get vector() {
    return new PhaserMath.Vector2(Math.cos(this._line.rotation), Math.sin(this._line.rotation));
  }

  public get alpha() {
    return this._line.alpha;
  }

  public get opacity() {
    return this._opacity;
  }

  public get incline() {
    return this._incline;
  }

  public get elements() {
    return [this._line, ...this._noteContainersArr];
  }

  public get index() {
    return this._index;
  }

  public get debug() {
    return this._debug;
  }

  setVisible(visible: boolean) {
    [
      !this._hasAttach || this._data.appearanceOnAttach ? this._line : undefined,
      ...this._noteContainersArr,
    ].forEach((obj) => {
      obj?.setVisible(visible);
    });
  }
}
