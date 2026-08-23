import { GameObjects } from 'phaser';
import { SkewImage } from 'phaser4-rex-plugins/plugins/quadimage';
import {
  JudgmentType,
  type AlphaControl,
  type Note,
  type PosControl,
  type SizeControl,
  type SkewControl,
  type YControl,
} from '$lib/types';
import { clamp, isDebug } from '$lib/utils';
import { calculateValue, ControlTypes, easing, rgbToHex } from '../utils';
import type { Game } from '../scenes/Game';
import type { Line, LineFrameCtx } from './Line';
import { NOTE_BASE_SIZE, NOTE_PRIORITIES } from '../constants';

/**
 * Property name of the value field for each control type, indexed by
 * ControlTypes (ALPHA=0, POS=1, SIZE=2, SKEW=3, Y=4).
 */
const CONTROL_VALUE_KEYS = ['alpha', 'pos', 'size', 'skew', 'y'];

export class PlainNote extends SkewImage {
  /** Type tag used by the line's culling hot path (avoids `instanceof`). */
  readonly isHold = false as const;

  private _scene: Game;
  private _index: number;
  private _data: Note;
  private _line: Line;
  private _xModifier: 1 | -1 = 1;
  private _yModifier: 1 | -1;
  private _hitTime: number;
  public readonly visualEndTime: number;
  private _targetHeight: number = 0;

  private _alpha: number = 1;

  private _judgmentType: JudgmentType = JudgmentType.UNJUDGED;
  private _beatJudged: number | undefined = undefined;

  // ======================================================================
  // Official-judgment control state (managed by JudgmentHandler).
  // ======================================================================
  /** 点击匹配 marker (isJudged): set by click matching; blocks re-matching. */
  clickMatched = false;
  /** 红键匹配 marker (isJudgedForFlick): set by flick matching only. */
  flickMatched = false;
  /** DragControl proximity marker: a held finger was within range. */
  dragMarked = false;

  /**
   * Control-lookup cursor: one index per control type. Indices track the last
   * control node that applied for the previously evaluated chart distance, so
   * the per-frame scan is O(1) (a few node hops) instead of O(n).
   */
  private _controlIndex: number[] = [0, 0, 0, 0, 0];

  /** Precomputed base scale (pixels per note-size unit × skin size factor). */
  private _noteScaleBase: number;

  private _debug: GameObjects.Container | undefined = undefined;

  constructor(scene: Game, data: Note, index: number, highlight: boolean = false) {
    super(scene, 0, 0, `${data.type}${highlight ? '-hl' : ''}`);

    this._scene = scene;
    this._index = index;
    this._data = data;
    this._yModifier = data.above === 1 ? -1 : 1;
    this._hitTime = scene.timeUtil.getTimeSec(data.startBeat);
    this.visualEndTime = this._hitTime + 1;
    this._noteScaleBase =
      (989 / scene.skinSize) * scene.p(NOTE_BASE_SIZE * scene.preferences.noteSize);
    this.resize();
    this._alpha = data.alpha / 255;
    this.setAlpha(this._alpha);
    if (data.tint) {
      this.setTint(rgbToHex(data.tint));
    }

    if ([1, 2].includes(scene.preferences.chartFlipping)) {
      this._xModifier = -1;
    }

    this._data.yOffset *= this._data.speed; // bro's intercept depends on slope 👍👍👍

    if (isDebug()) {
      this._debug = new GameObjects.Container(scene);
    }

    this.setVisible(false);
  }

  update(beat: number, songTime: number, height: number, ctx?: LineFrameCtx) {
    const px = ctx?.px ?? this._scene.sys.canvas.width / 1350;
    const ox = ctx?.ox ?? this._scene.sys.canvas.height / 900;
    const dScale = ctx?.dScale ?? (this._scene.sys.canvas.height * 2) / 15;
    const invHeight900 = ctx ? ctx.invHeight900 : 900 / this._scene.sys.canvas.height;
    const dist =
      dScale * ((this._targetHeight - height) * this._data.speed) + ox * this._data.yOffset;
    const chartDist = dist * invHeight900;

    const lineOpacity = ctx?.lineOpacity ?? this._line.opacity;
    let visible = true;
    if (lineOpacity < 0) {
      if (lineOpacity === -2 && (dist * this._data.above === 1 ? -1 : 1) > 0) visible = true;
      else visible = false;
    }

    if (this._beatJudged && beat < this._beatJudged) {
      this._scene.judgment.unjudge(this);
    }
    if (this._data.isFake && beat >= this._data.startBeat) {
      if (this._judgmentType !== JudgmentType.PASSED) {
        this._judgmentType = JudgmentType.PASSED;
        this._beatJudged = beat;
        this.setVisible(false);
      }
    }
    if (this._judgmentType === JudgmentType.UNJUDGED) {
      const targetVisible =
        visible &&
        songTime >= this._hitTime - this._data.visibleTime &&
        (dist * this._data.speed >= 0 || !(ctx?.isCover ?? this._line.data.isCover));
      if (this.visible !== targetVisible) super.setVisible(targetVisible);
    }

    const xMod = this._xModifier;
    const posX = this._data.positionX;
    const incline = ctx?.lineIncline ?? this._line.incline;
    // The incline term vanishes when there is no incline event on the line
    // (the common case); skip the tan() entirely instead of evaluating it.
    const inclineOffset = incline
      ? Math.tan(((xMod * posX) / 675) * -incline * (Math.PI / 180)) * chartDist
      : 0;
    this.setX(
      px *
        (xMod *
          posX *
          this.getControlValue(
            chartDist,
            ControlTypes.POS,
            ctx?.posControl ?? this._line.data.posControl,
          ) +
          inclineOffset),
    );
    this.applySkewX(
      -xMod *
        posX *
        this.getControlValue(
          chartDist,
          ControlTypes.SKEW,
          ctx?.skewControl ?? this._line.data.skewControl,
        ),
    );
    this._alpha =
      (this._data.alpha *
        this.getControlValue(
          chartDist,
          ControlTypes.ALPHA,
          ctx?.alphaControl ?? this._line.data.alphaControl,
        )) /
      255;
    this.resize(chartDist);
    if (this._judgmentType !== JudgmentType.BAD) {
      this.setY(
        this._yModifier *
          dist *
          this.getControlValue(
            chartDist,
            ControlTypes.Y,
            ctx?.yControl ?? this._line.data.yControl,
          ),
      );
    }

    if (this._debug) {
      this._debug.copyPosition(this);
      this._debug.setRotation(this.rotation);
      this._debug.setScale(this._scene.p(1.4 * NOTE_BASE_SIZE));
    }
  }

  setHeight(height: number) {
    this._targetHeight = height;
  }

  applySkewX(deg: number) {
    if (deg === 0) return;
    super.setSkewXDeg(deg);
  }

  resize(chartDist: number | undefined = undefined) {
    const control = chartDist
      ? this.getControlValue(chartDist, ControlTypes.SIZE, this._line.data.sizeControl)
      : 1;
    const scale = this._data.size * control * this._noteScaleBase;
    this.setScale(scale, -this._yModifier * control * this._noteScaleBase);
  }

  getControlValue(
    x: number,
    type: number,
    control: AlphaControl[] | PosControl[] | SizeControl[] | SkewControl[] | YControl[],
  ): number {
    const len = control.length;
    if (len === 0) return 1;
    // Control nodes are sorted by descending `x` (processControlNodes). The
    // cursor tracks the last control node that applied for the previous chart
    // distance; walk forward while the next node is still at/right of our
    // distance, and back up if we overshot. Equivalent to the previous
    // `Array.at()`-based cursor, but without per-call allocations.
    let index = this._controlIndex[type];
    if (index >= len) index = len - 1;
    while (index + 1 < len && control[index + 1].x >= x) {
      index++;
    }
    while (index > 0 && control[index].x < x) {
      index--;
    }
    this._controlIndex[type] = index;

    const current = control[index] as unknown as {
      x: number;
      easing: number;
      [key: string]: number | undefined;
    };
    const next = (control[index + 1] ?? current) as unknown as typeof current;
    const key = CONTROL_VALUE_KEYS[type];
    const curVal = current[key] as number;
    const nextVal = next[key] as number;
    if (next.x === current.x) return curVal;
    const raw = (next.x - x) / (next.x - current.x);
    if (current.easing === 0) {
      return calculateValue(curVal, nextVal, 1 - clamp(raw, 0, 1)) as number;
    }
    return calculateValue(curVal, nextVal, 1 - easing(current.easing, undefined, raw)) as number;
  }

  reset() {
    this._judgmentType = JudgmentType.UNJUDGED;
    this._beatJudged = undefined;
    this.setAlpha(this._alpha);
    this.clearTint();
    if (this._data.tint) {
      this.setTint(rgbToHex(this._data.tint));
    }
  }

  /** Clears the official-judgment control state (seek/restart). */
  resetControl() {
    this.clickMatched = false;
    this.flickMatched = false;
    this.dragMarked = false;
  }

  public get judgmentPosition() {
    const y = this._yModifier * this._scene.o(this._data.yOffset);
    return {
      x: this._line.x + this.x * Math.cos(this._line.rotation) - y * Math.sin(this._line.rotation),
      y: this._line.y + this.x * Math.sin(this._line.rotation) + y * Math.cos(this._line.rotation),
    };
  }

  public get judgmentType() {
    return this._judgmentType;
  }

  setJudgment(type: JudgmentType, beat: number) {
    this._judgmentType = type;
    this._beatJudged = beat;
  }

  /** Taps have no temp-judgment stage; present for handler symmetry. */
  get beatTempJudged() {
    return undefined;
  }

  resetTemp() {}

  public get beatJudged() {
    return this._beatJudged;
  }

  public get hitTime() {
    return this._hitTime;
  }

  public get zIndex() {
    return this._data.zIndex !== undefined
      ? this._data.zIndex
      : NOTE_PRIORITIES[this._data.type] + 2;
  }

  public get line() {
    return this._line;
  }

  public set line(line: Line) {
    this._line = line;

    if (this._debug) {
      line.debug?.add(
        this._debug.add(this._scene.add.circle(0, 0, 32, 0xffff00).setOrigin(0.5)).add(
          this._scene.add
            .text(0, 72, `${this._line.index}/${this._index}`, {
              fontFamily: 'Outfit',
              fontSize: 80,
              color: '#e2e2e2',
              align: 'center',
            })
            .setOrigin(0.5),
        ),
      );
    }
  }

  public get note() {
    return this._data;
  }

  public get targetHeight() {
    return this._targetHeight;
  }

  public get floor() {
    return this.y;
  }
}
