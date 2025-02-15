// import { GameObjects } from 'phaser';
import { SkewImage } from 'phaser3-rex-plugins/plugins/quadimage.js';
import { JudgmentType, type Note } from '$lib/types';
import { clamp } from '$lib/utils';
import { getControlValue, getTimeSec, rgbToHex } from '../utils';
import type { Game } from '../scenes/Game';
import type { Line } from './Line';
import { NOTE_BASE_SIZE, NOTE_PRIORITIES } from '../constants';

export class PlainNote extends SkewImage {
  private _scene: Game;
  private _data: Note;
  private _line: Line;
  private _xModifier: 1 | -1 = 1;
  private _yModifier: 1 | -1;
  private _hitTime: number;
  private _targetHeight: number = 0;

  private _alpha: number = 1;

  private _judgmentType: JudgmentType = JudgmentType.UNJUDGED;
  private _beatJudged: number | undefined = undefined;
  private _isInJudgeWindow: boolean = false;
  private _pendingPerfect: boolean = false;
  private _hasTapInput: boolean = false;
  private _consumeTap: boolean = true;

  constructor(scene: Game, data: Note, highlight: boolean = false) {
    super(scene, undefined, undefined, `${data.type}${highlight ? '-hl' : ''}`);

    this._scene = scene;
    this._data = data;
    this._yModifier = data.above === 1 ? -1 : 1;
    this._hitTime = getTimeSec(scene.bpmList, data.startBeat);
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
  }

  update(beat: number, songTime: number, height: number, lineOpacity: number) {
    const dist =
      this._scene.d((this._targetHeight - height) * this._data.speed) +
      this._scene.o(this._data.yOffset);
    const chartDist = (dist / this._scene.sys.canvas.height) * 900;

    let visible = true;
    if (lineOpacity < 0) {
      if (lineOpacity === -2 && (dist * this._data.above === 1 ? -1 : 1) > 0) visible = true;
      else visible = false;
    }

    this.setX(
      this._scene.p(
        this._xModifier *
          this._data.positionX *
          getControlValue(chartDist, { type: 'pos', payload: this._line.data.posControl }) +
          Math.tan(
            ((this._xModifier * this._data.positionX) / 675) *
              -(this._line.incline ?? 0) *
              (Math.PI / 180),
          ) *
            chartDist,
      ),
    );
    this.setSkewXDeg(
      -this._xModifier *
        this._data.positionX *
        getControlValue(chartDist, { type: 'skew', payload: this._line.data.skewControl }),
    );
    this._alpha =
      (this._data.alpha *
        getControlValue(chartDist, {
          type: 'alpha',
          payload: this._line.data.alphaControl,
        })) /
      255;
    this.resize(chartDist);
    if (this._beatJudged && beat < this._beatJudged) {
      this._scene.judgment.unjudge(this);
    }
    if (this._judgmentType !== JudgmentType.BAD) {
      this.setY(
        this._yModifier *
          dist *
          getControlValue(chartDist, { type: 'y', payload: this._line.data.yControl }),
      );
    }
    if (beat >= this._data.startBeat) {
      if (this._data.isFake) {
        if (this._judgmentType !== JudgmentType.PASSED) {
          this._judgmentType = JudgmentType.PASSED;
          this._beatJudged = beat;
          this.setVisible(false);
        }
      }
    } else if (this._judgmentType === JudgmentType.UNJUDGED) {
      this.setVisible(
        visible &&
          songTime >= this._hitTime - this._data.visibleTime &&
          (dist >= this._scene.o(this._data.yOffset) || !this._line.data.isCover),
      );
    }
  }

  updateJudgment(beat: number, songTime: number) {
    beat /= this._line.data.bpmfactor;
    if (this._judgmentType === JudgmentType.UNJUDGED) {
      const deltaSec = songTime - this._hitTime;
      const delta = deltaSec * 1000;
      const { perfectJudgment, goodJudgment } = this._scene.preferences;
      const badJudgment = goodJudgment * 1.125;
      const progress = clamp(delta / goodJudgment, 0, 1);
      this.setAlpha(this._alpha * (1 - progress));
      if (beat >= this._data.startBeat) {
        if (this._scene.autoplay || this._pendingPerfect) {
          this._scene.judgment.hit(JudgmentType.PERFECT, deltaSec, this);
          this._pendingPerfect = false;
          return;
        }
        if (progress === 1) {
          this._scene.judgment.judge(JudgmentType.MISS, this);
          return;
        }
      }
      this._consumeTap = beat <= this._data.startBeat || this._data.type !== 4;
      const isTap = this._data.type === 1;
      const isFlick = this._data.type === 3;
      if (!this._pendingPerfect && Math.abs(delta) <= (isTap ? badJudgment : goodJudgment)) {
        if (!this._isInJudgeWindow) {
          this._line.addToJudgeWindow(this);
          this._isInJudgeWindow = true;
        }
        if (isTap && !this._hasTapInput) return;
        this._hasTapInput = false;
        if (!this._scene.pointer.findDrag(this, isFlick)) return;
        if (isTap && delta < -goodJudgment) {
          this._scene.judgment.hit(JudgmentType.BAD, deltaSec, this);
        } else if (delta < -perfectJudgment) {
          if (isTap) this._scene.judgment.hit(JudgmentType.GOOD_EARLY, deltaSec, this);
          else this._pendingPerfect = true;
        } else if (delta <= perfectJudgment) {
          if (isTap || delta >= 0) this._scene.judgment.hit(JudgmentType.PERFECT, deltaSec, this);
          else this._pendingPerfect = true;
        } else if (delta <= goodJudgment) {
          this._scene.judgment.hit(
            isTap ? JudgmentType.GOOD_LATE : JudgmentType.PERFECT,
            deltaSec,
            this,
          );
        } else {
          this._scene.judgment.hit(JudgmentType.BAD, deltaSec, this);
        }
      }
    }
  }

  setHeight(height: number) {
    this._targetHeight = height;
  }

  resize(chartDist: number | undefined = undefined) {
    const scale =
      (989 / this._scene.skinSize) *
      this._scene.p(NOTE_BASE_SIZE * this._scene.preferences.noteSize);
    const control = chartDist
      ? getControlValue(chartDist, {
          type: 'size',
          payload: this._line.data.sizeControl,
        })
      : 1;
    this.setScale(this._data.size * control * scale, -this._yModifier * control * scale);
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

  public get judgmentPosition() {
    const y = this._yModifier * this._scene.o(this._data.yOffset);
    return {
      x: this._line.x + this.x * Math.cos(this._line.rotation) + y * Math.sin(this._line.rotation),
      y: this._line.y + this.x * Math.sin(this._line.rotation) + y * Math.cos(this._line.rotation),
    };
  }

  public get judgmentType() {
    return this._judgmentType;
  }

  setJudgment(type: JudgmentType, beat: number) {
    this._judgmentType = type;
    this._beatJudged = beat;
    this._line.removeFromJudgeWindow(this);
    this._isInJudgeWindow = false;
  }

  public get beatJudged() {
    return this._beatJudged;
  }

  public get hitTime() {
    return this._hitTime;
  }

  public get hasTapInput() {
    return this._hasTapInput;
  }

  public set hasTapInput(hasTapInput: boolean) {
    this._hasTapInput = hasTapInput;
  }

  public get consumeTap() {
    return this._consumeTap;
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
  }

  public get note() {
    return this._data;
  }
}
