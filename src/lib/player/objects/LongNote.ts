import { GameObjects } from 'phaser';
import { GameStatus, JudgmentType, type Note } from '$lib/types';
import type { Game } from '../scenes/Game';
import type { Line, LineFrameCtx } from './Line';
import { rgbToHex } from '../utils';
import {
  HOLD_BODY_TOLERANCE,
  HOLD_TAIL_TOLERANCE,
  NOTE_BASE_SIZE,
  NOTE_PRIORITIES,
} from '../constants';
import { isDebug } from '$lib/utils';

export class LongNote extends GameObjects.Container {
  /** Type tag used by the line's culling hot path (avoids `instanceof`). */
  readonly isHold = true as const;

  private _scene: Game;
  private _index: number;
  private _data: Note;
  private _line: Line;
  private _xModifier: 1 | -1 = 1;
  private _yModifier: 1 | -1;
  private _head: GameObjects.Image;
  private _body: GameObjects.Image | GameObjects.TileSprite;
  private _tail: GameObjects.Image;
  private _isBodyRepeat: boolean = false;
  private _isKeepHead: boolean = false;
  private _bodyWidth: number;
  private _bodyHeight: number;
  private _hitTime: number;
  private _endTime: number;
  public readonly visualEndTime: number;
  private _targetHeadHeight: number = 0;
  private _targetTailHeight: number = 0;
  private _judgmentType: JudgmentType = JudgmentType.UNJUDGED;
  private _beatJudged: number | undefined = undefined;
  private _tempJudgmentType: JudgmentType = JudgmentType.UNJUDGED;
  private _beatTempJudged: number | undefined = undefined;
  private _isInJudgeWindow: boolean = false;
  private _lastInputBeat: number = 0;
  private _lastInputTimeSec: number = 0;
  private _isTapped: boolean = false;
  private _consumeTap: boolean = true;

  /** Precomputed base scale (pixels per note-size unit × skin size factor). */
  private _noteScaleBase: number;

  private _debug: GameObjects.Container | undefined = undefined;

  constructor(scene: Game, data: Note, index: number, highlight: boolean = false) {
    super(scene);

    this._scene = scene;
    this._index = index;
    this._data = data;
    this._yModifier = data.above ? -1 : 1;
    this._head = new GameObjects.Image(scene, 0, 0, `2-h${highlight ? '-hl' : ''}`);
    this._isBodyRepeat = scene.respack.isHoldBodyRepeat();
    this._isKeepHead = scene.respack.isHoldKeepHead();
    this._body = this._isBodyRepeat
      ? new GameObjects.TileSprite(scene, 0, 0, 0, 0, `2${highlight ? '-hl' : ''}`)
      : new GameObjects.Image(scene, 0, 0, `2${highlight ? '-hl' : ''}`);
    this._tail = new GameObjects.Image(scene, 0, 0, `2-t${highlight ? '-hl' : ''}`);
    const isCompact = scene.respack.isHoldCompact();
    this._head.setOrigin(0.5, isCompact ? 0.5 : 0);
    this._body.setOrigin(0.5, 1);
    this._tail.setOrigin(0.5, isCompact ? 0.5 : 1);
    this._noteScaleBase =
      (989 / scene.skinSize) * scene.p(NOTE_BASE_SIZE * scene.preferences.noteSize);
    this.setAlpha(data.alpha / 255);
    if (data.tint) {
      this.setTint(rgbToHex(data.tint));
    }
    this._hitTime = scene.timeUtil.getTimeSec(data.startBeat);
    this._endTime = scene.timeUtil.getTimeSec(data.endBeat);
    this.visualEndTime = this._endTime + 1;
    const bodyTexture = this._body.texture.getSourceImage();
    this._bodyWidth = bodyTexture.width;
    this._bodyHeight = bodyTexture.height;

    this.add([this._body, this._tail, this._head]);

    if ([1, 2].includes(scene.preferences.chartFlipping)) {
      this._xModifier = -1;
    }

    this._data.yOffset *= this._data.speed; // bro's intercept depends on slope 👍👍👍

    if (isDebug()) {
      this._debug = new GameObjects.Container(scene);
    }

    // Static appearance: the note's scale never changes during playback
    // (holds have no size controls), so apply it once here instead of every
    // frame. Requires _bodyWidth/_bodyHeight to be assigned first.
    this.resize();
    this.setX(this._scene.p(this._xModifier * data.positionX));

    this._head.setVisible(false);
    this._body.setVisible(false);
    this._tail.setVisible(false);
  }

  update(beat: number, songTime: number, height: number, ctx?: LineFrameCtx) {
    // Line-level culling may hide the container. Restore the container before
    // evaluating the individual head/body/tail visibility for this frame.
    if (!this.visible) super.setVisible(true);
    const ox = ctx?.ox ?? this._scene.sys.canvas.height / 900;
    const dScale = ctx?.dScale ?? (this._scene.sys.canvas.height * 2) / 15;
    const yOffset = ox * this._data.yOffset;
    let headDist = dScale * ((this._targetHeadHeight - height) * this._data.speed) + yOffset;
    const tailDist = dScale * ((this._targetTailHeight - height) * this._data.speed) + yOffset;

    const lineOpacity = ctx?.lineOpacity ?? this._line.opacity;
    let visible = true;
    if (lineOpacity < 0) {
      if (lineOpacity === -2 && (headDist * this._data.above === 1 ? -1 : 1) > 0) visible = true;
      else visible = false;
    }

    if (this._beatJudged && beat < this._beatJudged) {
      this._scene.judgment.unjudge(this);
    }
    if (this._beatTempJudged && beat < this._beatTempJudged) {
      this.resetTemp();
    }

    let headVisible: boolean;
    if (beat > this._data.startBeat) {
      headVisible = this._isKeepHead && beat <= this._data.endBeat;
      headDist = yOffset;
    } else {
      headVisible =
        visible &&
        songTime >= this._hitTime - this._data.visibleTime &&
        (headDist * this._data.speed >= 0 ||
          !(ctx?.isCover ?? this._line.data.isCover) ||
          (this._isKeepHead && beat <= this._data.endBeat));
    }
    if (this._head.visible !== headVisible) this._head.setVisible(headVisible);
    if (this._data.isFake) {
      if (this._judgmentType !== JudgmentType.PASSED && beat >= this._data.endBeat)
        this._judgmentType = JudgmentType.PASSED;
      this._beatJudged = beat;
    }
    const isCover = ctx?.isCover ?? this._line.data.isCover;
    if (beat > this._data.endBeat) {
      if (this._body.visible) this._body.setVisible(false);
      if (this._tail.visible) this._tail.setVisible(false);
    } else {
      const vis =
        visible &&
        songTime >= this._hitTime - this._data.visibleTime &&
        (tailDist * this._data.speed >= 0 || !isCover);
      if (this._body.visible !== vis) this._body.setVisible(vis);
      if (this._tail.visible !== vis) this._tail.setVisible(vis);
    }

    this._head.setY(this._yModifier * headDist);
    this._body.setY(this._yModifier * (isCover ? Math.max(0, headDist) : headDist));
    this._tail.setY(this._yModifier * tailDist);
    const bodyHeight =
      -this._yModifier *
      (isCover ? Math.max(0, tailDist - Math.max(0, headDist)) : Math.max(0, tailDist - headDist));
    if (this._isBodyRepeat) this._body.height = bodyHeight;
    else this._body.scaleY = bodyHeight / this._bodyHeight;

    if (this._debug) {
      this._debug.setX(this.x);
      this._debug.setY(this.floor);
      this._debug.setRotation(this.rotation);
      this._debug.setScale(this._scene.p(1.4 * NOTE_BASE_SIZE));
    }
  }

  updateJudgment(beat: number, songTime: number) {
    beat /= this._line.data.bpmfactor;
    if (this._tempJudgmentType === JudgmentType.UNJUDGED) {
      const deltaSec = songTime - this._hitTime;
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
        if (!this._isInJudgeWindow) {
          this._line.addToJudgeWindow(this);
          this._isInJudgeWindow = true;
        }
        if (!this._isTapped) return;
        if (delta < -perfectJudgment) {
          this._scene.judgment.hold(JudgmentType.GOOD_EARLY, deltaSec, this);
        } else if (delta <= perfectJudgment) {
          this._scene.judgment.hold(JudgmentType.PERFECT, deltaSec, this);
        } else {
          this._scene.judgment.hold(JudgmentType.GOOD_LATE, deltaSec, this);
        }
        this._lastInputBeat = beat;
        this._isTapped = false;
      }
    } else if (this._judgmentType === JudgmentType.UNJUDGED) {
      // `beat` is the line-local beat (already scaled by bpmfactor); its
      // converted seconds are line-local too, so cache them consistently.
      const lineTimeSec = this._scene.timeUtil.getTimeSec(beat);
      if (!this._scene.autoplay) {
        const input = this._scene.keyboard?.findDrag(this) || this._scene.pointer?.findDrag(this);
        if (input) {
          this._lastInputBeat = beat;
          this._lastInputTimeSec = lineTimeSec;
        } else if (
          lineTimeSec - this._lastInputTimeSec > HOLD_BODY_TOLERANCE / 1000 ||
          this._scene.status === GameStatus.SEEKING
        ) {
          // this.setTint(0xff0000);
          this._scene.judgment.judge(JudgmentType.MISS, this);
          return;
        }
      }
      // The hold end time was converted once in the constructor.
      if (this._endTime - lineTimeSec < HOLD_TAIL_TOLERANCE / 1000) {
        this._scene.judgment.judge(this._tempJudgmentType, this);
      }
    }
  }

  setTint(tint: number | undefined) {
    this._head.setTint(tint);
    this._body.setTint(tint);
    this._tail.setTint(tint);
  }

  clearTint() {
    this._head.clearTint();
    this._body.clearTint();
    this._tail.clearTint();
  }

  setHeadHeight(height: number) {
    this._targetHeadHeight = height;
  }

  setTailHeight(height: number) {
    this._targetTailHeight = height;
  }

  resize() {
    const base = this._noteScaleBase;
    this._head.setScale(this._data.size * base, -this._yModifier * base);
    if (this._isBodyRepeat) {
      this._body.scaleX = this._data.size;
      this._body.width = base * this._bodyWidth;
      (this._body as GameObjects.TileSprite).setTileScale(this._data.size * base, base);
    } else {
      this._body.setScale(this._data.size * base, base);
    }
    this._tail.setScale(this._data.size * base, -this._yModifier * base);
  }

  reset() {
    this._judgmentType = JudgmentType.UNJUDGED;
    this._beatJudged = undefined;
    this.setVisible(true);
    this.resetAppearance();
  }

  resetTemp() {
    this._tempJudgmentType = JudgmentType.UNJUDGED;
    this._beatTempJudged = undefined;
    this.setVisible(true);
    this.resetAppearance();
  }

  resetAppearance() {
    this.setAlpha(this._data.alpha / 255);
    this.clearTint();
    if (this._data.tint) {
      this.setTint(rgbToHex(this._data.tint));
    }
  }

  setVisible(value: boolean) {
    super.setVisible(value);
    if (value) {
      this._head.setVisible(true);
      this._body.setVisible(true);
      this._tail.setVisible(true);
    }
    return this;
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
    if (this._tempJudgmentType === JudgmentType.UNJUDGED) {
      this._tempJudgmentType = type;
      this._beatTempJudged = beat;
    }
  }

  public get beatJudged() {
    return this._beatJudged;
  }

  public get hitTime() {
    return this._hitTime;
  }

  public get endHitTime() {
    return this._endTime;
  }

  public get isTapped() {
    return this._isTapped;
  }

  public set isTapped(isTapped: boolean) {
    this._isTapped = isTapped;
  }

  public get tempJudgmentType() {
    return this._tempJudgmentType;
  }

  setTempJudgment(type: JudgmentType, beat: number) {
    this._tempJudgmentType = type;
    this._beatTempJudged = beat;
    this._line.removeFromJudgeWindow(this);
    this._isInJudgeWindow = false;
  }

  public get beatTempJudged() {
    return this._beatTempJudged;
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

  public get headTargetHeight() {
    return this._targetHeadHeight;
  }

  public get tailTargetHeight() {
    return this._targetTailHeight;
  }

  public get floor() {
    return Math.max(this._head.y, this._tail.y);
  }
}
