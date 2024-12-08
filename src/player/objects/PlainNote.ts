import { GameObjects } from 'phaser';
import { JudgmentType, type Note } from '../types';
import { clamp, getTimeSec, rgbToHex } from '../utils';
import type { Game } from '../scenes/Game';
import type { Line } from './Line';
import { NOTE_BASE_SIZE } from '../constants';

export class PlainNote extends GameObjects.Image {
  private _scene: Game;
  private _data: Note;
  private _line: Line;
  private _xModifier: 1 | -1 = 1;
  private _yModifier: 1 | -1;
  private _hitTime: number;
  private _targetHeight: number = 0;
  private _judgmentType: JudgmentType = JudgmentType.UNJUDGED;
  private _beatJudged: number | undefined = undefined;
  private _pendingPerfect: boolean = false;

  constructor(scene: Game, data: Note, x: number = 0, y: number = 0, highlight: boolean = false) {
    super(scene, x, y, `${data.type}${highlight ? '-hl' : ''}`);

    this._scene = scene;
    this._data = data;
    this._yModifier = data.above === 1 ? -1 : 1;
    this._hitTime = getTimeSec(scene.bpmList, data.startBeat);
    this.setOrigin(0.5);
    this.resize();
    this.setAlpha(data.alpha / 255);

    if ([1, 2].includes(scene.preferences.chartFlipping)) {
      this._xModifier = -1;
    }
  }

  update(beat: number, songTime: number, height: number, visible = true) {
    this.setX(this._scene.p(this._xModifier * this._data.positionX));
    this.resize();
    if (this._beatJudged && beat < this._beatJudged) {
      this._scene.judgment.unjudge(this);
    }
    const dist = this._scene.d((this._targetHeight - height) * this._data.speed);
    if (this._judgmentType !== JudgmentType.BAD) {
      this.setY(this._yModifier * dist);
      if (this._data.tint) {
        this.setTint(rgbToHex(this._data.tint));
      }
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
          (dist >= 0 || !this._line.data.isCover),
      );
    }
  }

  updateJudgment(beat: number) {
    beat *= this._line.data.bpmfactor;
    if (this._judgmentType === JudgmentType.UNJUDGED) {
      const deltaSec = getTimeSec(this._scene.bpmList, beat) - this._hitTime;
      const delta = deltaSec * 1000;
      const { perfectJudgment, goodJudgment } = this._scene.preferences;
      const badJudgment = goodJudgment * 1.125;
      const progress = clamp(delta / goodJudgment, 0, 1);
      this.setAlpha((this._data.alpha / 255) * (1 - progress));
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
      const isTap = this._data.type === 1;
      const isFlick = this._data.type === 3;
      if (Math.abs(delta) <= (isTap ? badJudgment : goodJudgment)) {
        const input = isTap
          ? this._scene.pointer.findTap(
              this,
              this._scene.timeSec - (isTap ? badJudgment : goodJudgment) / 1000,
              this._scene.timeSec + goodJudgment / 1000,
            )
          : this._scene.pointer.findDrag(this, isFlick);
        if (!input) return;
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

  setHighlight(highlight: boolean) {
    this.setTexture(`${this._data.type}${highlight ? '-hl' : ''}`);
  }

  setHeight(height: number) {
    this._targetHeight = height;
  }

  resize() {
    const scale = this._scene.p(NOTE_BASE_SIZE * this._scene.preferences.noteSize);
    this.setScale(this._data.size * scale, -this._yModifier * scale);
  }

  reset() {
    this._judgmentType = JudgmentType.UNJUDGED;
    this._beatJudged = undefined;
    this.setAlpha(this._data.alpha / 255);
    this.clearTint();
  }

  public get judgmentPosition() {
    return {
      x: this._line.x + this.x * Math.cos(this._line.rotation),
      y: this._line.y + this.x * Math.sin(this._line.rotation),
    };
  }

  public get judgmentType() {
    return this._judgmentType;
  }

  setJudgment(type: JudgmentType, beat: number) {
    this._judgmentType = type;
    this._beatJudged = beat;
  }

  public get beatJudged() {
    return this._beatJudged;
  }

  public get line() {
    return this._line;
  }

  setLine(line: Line) {
    this._line = line;
  }

  get(key: string) {
    return this._data[key as keyof Note];
  }

  public get note() {
    return this._data;
  }
}
