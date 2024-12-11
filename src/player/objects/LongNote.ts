import { GameObjects } from 'phaser';
import { JudgmentType, type Note } from '../types';
import type { Game } from '../scenes/Game';
import type { Line } from './Line';
import { getTimeSec } from '../utils';
import { HOLD_BODY_TOLERANCE, HOLD_TAIL_TOLERANCE, NOTE_BASE_SIZE } from '../constants';

export class LongNote extends GameObjects.Container {
  private _scene: Game;
  private _data: Note;
  private _line: Line;
  private _xModifier: 1 | -1 = 1;
  private _yModifier: 1 | -1;
  private _head: GameObjects.Image;
  private _body: GameObjects.Image;
  private _tail: GameObjects.Image;
  private _bodyHeight: number;
  private _hitTime: number;
  private _targetHeadHeight: number = 0;
  private _targetTailHeight: number = 0;
  private _judgmentType: JudgmentType = JudgmentType.UNJUDGED;
  private _beatJudged: number | undefined = undefined;
  private _tempJudgmentType: JudgmentType = JudgmentType.UNJUDGED;
  private _beatTempJudged: number | undefined = undefined;
  private _lastInputBeat: number = 0;
  private _consumeTap: boolean = true;

  constructor(scene: Game, data: Note, x: number = 0, y: number = 0, highlight: boolean = false) {
    super(scene, x, y);

    this._scene = scene;
    this._data = data;
    this._yModifier = data.above ? -1 : 1;
    this._head = new GameObjects.Image(scene, 0, 0, `2-h${highlight ? '-hl' : ''}`);
    this._body = new GameObjects.Image(scene, 0, 0, `2${highlight ? '-hl' : ''}`);
    this._tail = new GameObjects.Image(scene, 0, 0, `2-t${highlight ? '-hl' : ''}`);
    this._head.setOrigin(0.5, 0);
    this._body.setOrigin(0.5, 1);
    this._tail.setOrigin(0.5, 1);
    this.resize();
    this._bodyHeight = this._body.texture.getSourceImage().height;
    this._hitTime = getTimeSec(scene.bpmList, data.startBeat);

    this.add([this._head, this._body, this._tail]);

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
    if (this._beatTempJudged && beat < this._beatTempJudged) {
      this.resetTemp();
    }
    let headDist = this._scene.d((this._targetHeadHeight - height) * this._data.speed);
    const tailDist = this._scene.d((this._targetTailHeight - height) * this._data.speed);
    if (beat >= this._data.startBeat) {
      this._head.setVisible(false);
      headDist = 0;
    } else {
      this._head.setVisible(
        visible &&
          songTime >= this._hitTime - this._data.visibleTime &&
          (headDist >= 0 || !this._line.data.isCover),
      );
    }
    if (beat >= this._data.endBeat) {
      this._body.setVisible(false);
      this._tail.setVisible(false);
    } else {
      const vis =
        visible &&
        songTime >= this._hitTime - this._data.visibleTime &&
        (tailDist >= 0 || !this._line.data.isCover);
      this._body.setVisible(vis);
      this._tail.setVisible(vis);
    }
    this._head.setY(this._yModifier * headDist);
    this._body.setY(this._yModifier * (this._line.data.isCover ? Math.max(0, headDist) : headDist));
    this._tail.setY(this._yModifier * tailDist);
    this._body.scaleY =
      (-this._yModifier *
        (this._line.data.isCover
          ? Math.max(0, tailDist - Math.max(0, headDist))
          : tailDist - headDist)) /
      this._bodyHeight;
    if (this._data.isFake) {
      if (this._judgmentType !== JudgmentType.PASSED && beat >= this._data.endBeat)
        this._judgmentType = JudgmentType.PASSED;
      this._beatJudged = beat;
      return;
    }
  }

  updateJudgment(beat: number) {
    if (this._tempJudgmentType === JudgmentType.UNJUDGED) {
      const deltaSec = getTimeSec(this._scene.bpmList, beat) - this._hitTime;
      const delta = deltaSec * 1000;
      const { perfectJudgment, goodJudgment } = this._scene.preferences;
      if (beat >= this._data.startBeat) {
        if (this._scene.autoplay) {
          this._scene.judgment.hold(JudgmentType.PERFECT, deltaSec, this);
          return;
        }
        if (delta > goodJudgment) {
          this._scene.judgment.judge(JudgmentType.MISS, this);
          return;
        }
      }
      if (delta >= -goodJudgment && delta <= goodJudgment) {
        const input = this._scene.pointer.findTap(
          this,
          this._scene.timeSec - goodJudgment / 1000,
          this._scene.timeSec + goodJudgment / 1000,
        );
        if (!input) return;
        if (delta < -perfectJudgment) {
          this._scene.judgment.hold(JudgmentType.GOOD_EARLY, deltaSec, this);
        } else if (delta <= perfectJudgment) {
          this._scene.judgment.hold(JudgmentType.PERFECT, deltaSec, this);
        } else {
          this._scene.judgment.hold(JudgmentType.GOOD_LATE, deltaSec, this);
        }
        this._lastInputBeat = beat;
      }
    } else if (this._judgmentType === JudgmentType.UNJUDGED) {
      if (!this._scene.autoplay) {
        const input = this._scene.pointer.findDrag(this);
        if (input) {
          this._lastInputBeat = beat;
        } else if (
          getTimeSec(this._scene.bpmList, beat) -
            getTimeSec(this._scene.bpmList, this._lastInputBeat) >
          HOLD_BODY_TOLERANCE / 1000
        ) {
          this._scene.judgment.judge(JudgmentType.MISS, this);
        }
      }
      if (
        getTimeSec(this._scene.bpmList, this._data.endBeat) -
          getTimeSec(this._scene.bpmList, beat) <
        HOLD_TAIL_TOLERANCE / 1000
      ) {
        this._scene.judgment.judge(this._tempJudgmentType, this);
      }
    }
  }

  setHighlight(highlight: boolean) {
    this._head.setTexture(`2-h${highlight ? '-hl' : ''}`);
    this._body.setTexture(`2${highlight ? '-hl' : ''}`);
    this._tail.setTexture(`2-t${highlight ? '-hl' : ''}`);
    this._bodyHeight = this._body.texture.getSourceImage().height;
  }

  setHeadHeight(height: number) {
    this._targetHeadHeight = height;
  }

  setTailHeight(height: number) {
    this._targetTailHeight = height;
  }

  resize() {
    const scale = this._scene.p(NOTE_BASE_SIZE * this._scene.preferences.noteSize);
    this._head.setScale(this._data.size * scale, -this._yModifier * scale);
    this._body.scaleX = this._data.size * scale;
    this._tail.setScale(this._data.size * scale, -this._yModifier * scale);
  }

  reset() {
    this._judgmentType = JudgmentType.UNJUDGED;
    this._beatJudged = undefined;
    this.setAlpha(this._data.alpha / 255);
  }

  resetTemp() {
    this._tempJudgmentType = JudgmentType.UNJUDGED;
    this._beatTempJudged = undefined;
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
    if (this._tempJudgmentType === JudgmentType.UNJUDGED) {
      this._tempJudgmentType = type;
      this._beatTempJudged = beat;
    }
  }

  public get beatJudged() {
    return this._beatJudged;
  }

  public get tempJudgmentType() {
    return this._tempJudgmentType;
  }

  setTempJudgment(type: JudgmentType, beat: number) {
    this._tempJudgmentType = type;
    this._beatTempJudged = beat;
  }

  public get beatTempJudged() {
    return this._beatTempJudged;
  }

  public get consumeTap() {
    return this._consumeTap;
  }

  public set consumeTap(consumeTap: boolean) {
    this._consumeTap = consumeTap;
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
