import { GameObjects } from 'phaser';
import { HitEffects } from '../objects/HitEffects';
import type { LongNote } from '../objects/LongNote';
import type { PlainNote } from '../objects/PlainNote';
import type { Game } from '../scenes/Game';
import { JudgmentType, GameStatus, type PointerTap } from '../types';
import { isPerfectOrGood, getJudgmentColor, rgbToHex, getJudgmentPosition } from '../utils';
import { JUDGMENT_THRESHOLD } from '../constants';
import { equal } from 'mathjs';

export class JudgmentHandler {
  private _scene: Game;
  private _perfect: number = 0;
  private _goodEarly: number = 0;
  private _goodLate: number = 0;
  private _bad: number = 0;
  private _miss: number = 0;
  private _judgmentCount: number = 0;
  private _judgmentIndex: number = 0;
  private _judgmentDeltas: { delta: number; beat: number }[] = [];
  private _hitEffectsContainer: GameObjects.Container;

  constructor(scene: Game) {
    this._scene = scene;
    this._hitEffectsContainer = new GameObjects.Container(scene).setDepth(7);
    this._scene.register(this._hitEffectsContainer);
  }

  hit(type: JudgmentType, delta: number, note: PlainNote) {
    delta /= this._scene.song.rate;
    if (
      this._scene.status === GameStatus.PLAYING &&
      (!this._scene.autoplay || Math.abs(delta) < 1e-1)
    ) {
      if (isPerfectOrGood(type)) {
        this.createHitsound(note);
        this.createHitEffects(type, note);
      } else if (type === JudgmentType.BAD) {
        note.setTint(getJudgmentColor(type));
        this._scene.tweens.add({
          targets: note,
          alpha: 0,
          easing: 'Cubic.easeIn',
          duration: 500,
        });
      }
    }
    this.judge(
      type,
      note,
      this._scene.status === GameStatus.PLAYING &&
        note.note.type === 1 &&
        (isPerfectOrGood(type) || type === JudgmentType.BAD)
        ? delta
        : undefined,
    );
  }

  judge(type: JudgmentType, note: PlainNote | LongNote, delta?: number) {
    const beat = this._scene.beat;
    note.setJudgment(type, beat);
    if (note.note.type === 2) {
      if (type === JudgmentType.MISS) {
        note.setAlpha(0.5);
      }
    } else if (type !== JudgmentType.BAD) {
      note.setVisible(false);
    }
    switch (type) {
      case JudgmentType.PERFECT:
        this._perfect++;
        break;
      case JudgmentType.GOOD_EARLY:
        this._goodEarly++;
        break;
      case JudgmentType.GOOD_LATE:
        this._goodLate++;
        break;
      case JudgmentType.BAD:
        this._bad++;
        break;
      case JudgmentType.MISS:
        this._miss++;
        break;
    }
    this.countJudgments();
    if (isPerfectOrGood(type)) {
      this._scene.statistics.combo++;
    } else {
      this._scene.statistics.combo = 0;
    }
    this._scene.statistics.updateRecords();
    if (delta) {
      this._judgmentDeltas.push({ delta, beat });
    }
  }

  unjudge(note: PlainNote | LongNote) {
    switch (note.judgmentType) {
      case JudgmentType.PERFECT:
        this._perfect--;
        break;
      case JudgmentType.GOOD_EARLY:
        this._goodEarly--;
        break;
      case JudgmentType.GOOD_LATE:
        this._goodLate--;
        break;
      case JudgmentType.BAD:
        this._bad--;
        break;
      case JudgmentType.MISS:
        this._miss--;
        break;
    }
    this.countJudgments();
    this._scene.statistics.updateRecords(true);
    note.reset();
  }

  hold(type: JudgmentType, delta: number, note: LongNote) {
    delta /= this._scene.song.rate;
    const beat = this._scene.beat;
    if (
      this._scene.status === GameStatus.PLAYING &&
      (!this._scene.autoplay || Math.abs(delta) < 1e-1)
    ) {
      this.createHitsound(note);
      this.createHitEffects(type, note);
      const timer = setInterval(() => {
        if (
          note.judgmentType !== JudgmentType.UNJUDGED ||
          this._scene.beat < note.note.startBeat ||
          this._scene.beat > note.note.endBeat
        ) {
          clearInterval(timer);
          return;
        }
        if (this._scene.status === GameStatus.PLAYING) {
          this.createHitEffects(type, note);
        }
      }, 24000 / this._scene.bpm);
      this._judgmentDeltas.push({ delta, beat });
    }
    note.setTempJudgment(type, beat);
  }

  createHitEffects(type: JudgmentType, note: PlainNote | LongNote) {
    const { x, y } = note.judgmentPosition;
    this._hitEffectsContainer.add(
      new HitEffects(this._scene, x, y, type).hit(rgbToHex(note.note.tintHitEffects)),
    );
  }

  createHitsound(note: PlainNote | LongNote) {
    this._scene.sound
      .add(note.note.hitsound ? `asset-${note.note.hitsound}` : note.note.type.toString())
      .setVolume(this._scene.preferences.hitSoundVolume)
      .play();
  }

  countJudgments() {
    this._judgmentCount = this._perfect + this._goodEarly + this._goodLate + this._bad + this._miss;
  }

  rewindDeltas(beat: number) {
    this._judgmentDeltas = this._judgmentDeltas.filter((v) => v.beat <= beat);
  }

  reset() {
    this._judgmentDeltas = [];
  }

  judgeTap(input?: PointerTap) {
    const currentTimeSec = this._scene.timeSec;
    const { goodJudgment } = this._scene.preferences;
    const badJudgment = goodJudgment * 1.125;
    const threshold = this._scene.p(JUDGMENT_THRESHOLD);
    while (
      this._judgmentIndex > 0 &&
      this._scene.notes[this._judgmentIndex].hitTime >= currentTimeSec - badJudgment / 1000
    ) {
      this._judgmentIndex--;
    }
    while (
      this._judgmentIndex < this._scene.numberOfNotes &&
      this._scene.notes[this._judgmentIndex].hitTime < currentTimeSec - badJudgment / 1000
    ) {
      this._judgmentIndex++;
    }
    let nearestNote: PlainNote | LongNote | undefined = undefined;
    let minBeat: number = Infinity;
    let minDistance: number = Infinity;
    let minType: number = Infinity;
    for (
      let i = this._judgmentIndex, note: PlainNote | LongNote | undefined = this._scene.notes.at(i);
      note &&
      note.hitTime <= currentTimeSec + (note.note.type === 1 ? badJudgment : goodJudgment) / 1000;
      note = this._scene.notes.at(++i)
    ) {
      if (!note.consumeTap || note.hasTapInput || note.judgmentType !== JudgmentType.UNJUDGED) {
        continue;
      }
      const distance = input
        ? (Phaser.Math.Distance.BetweenPoints(
            note.judgmentPosition,
            getJudgmentPosition(input, note.line),
          ) *
            1350) /
          this._scene.sys.canvas.width
        : Infinity;
      if (distance > threshold) {
        if (input) {
          this._scene.tweens.add({
            targets: [
              this._scene.add
                .circle(
                  getJudgmentPosition(input, note.line).x,
                  getJudgmentPosition(input, note.line).y,
                  36,
                  0xff0000,
                )
                .setAlpha(0.9)
                .setDepth(100),
            ],
            alpha: 0,
            duration: 500,
          });
        }
        continue;
      }
      if (input) {
        this._scene.tweens.add({
          targets: [
            this._scene.add
              .circle(
                getJudgmentPosition(input, note.line).x,
                getJudgmentPosition(input, note.line).y,
                36,
                0x0077ff,
              )
              .setAlpha(0.9)
              .setDepth(100),
          ],
          alpha: 0,
          duration: 500,
        });
      }
      if (
        minBeat > note.note.startBeat ||
        (equal(minBeat, note.note.startBeat) && minDistance > distance) ||
        (equal(minBeat, note.note.startBeat) &&
          equal(minDistance, distance) &&
          minType > note.note.type)
      ) {
        nearestNote = note;
        minBeat = note.note.startBeat;
        minDistance = distance;
        minType = note.note.type;
        note.setTint(0x0077ff);
      }
    }
    if (nearestNote) {
      nearestNote.hasTapInput = true;
      nearestNote.setTint(0x00ff00);
      if (input) {
        this._scene.tweens.add({
          targets: [
            this._scene.add
              .circle(
                getJudgmentPosition(input, nearestNote.line).x,
                getJudgmentPosition(input, nearestNote.line).y,
                36,
                0x00ff00,
              )
              .setAlpha(0.9)
              .setDepth(100),
          ],
          alpha: 0,
          duration: 500,
        });
      }
    }
  }

  public get perfect() {
    return this._perfect;
  }

  public get goodEarly() {
    return this._goodEarly;
  }

  public get goodLate() {
    return this._goodLate;
  }

  public get bad() {
    return this._bad;
  }

  public get miss() {
    return this._miss;
  }

  public get judgmentCount() {
    return this._judgmentCount;
  }

  public get judgmentDeltas() {
    return this._judgmentDeltas;
  }
}
