import { GameObjects } from 'phaser';
import { HitEffects } from '../objects/HitEffects';
import type { LongNote } from '../objects/LongNote';
import type { PlainNote } from '../objects/PlainNote';
import type { Game } from '../scenes/Game';
import { JudgmentType, GameStatus, type PointerTap } from '$lib/types';
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
  private _judgmentDeltas: { delta: number; beat: number }[] = [];
  private _hitEffectsContainers: Record<number, GameObjects.Container> = {};

  constructor(scene: Game) {
    this._scene = scene;
    [...new Set(scene.notes.map((note) => note.note.zIndexHitEffects))].forEach((zIndex) => {
      this.createHitEffectsContainer(zIndex ?? 7);
    });
  }

  hit(type: JudgmentType, delta: number, note: PlainNote) {
    delta /= this._scene.timeScale;
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
    delta /= this._scene.timeScale;
    const beat = this._scene.beat;
    if (
      this._scene.status === GameStatus.PLAYING &&
      (!this._scene.autoplay || Math.abs(delta) < 1e-1)
    ) {
      this.createHitsound(note);
      this.createHitEffects(type, note);
      const timer = setInterval(
        () => {
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
        },
        30000 / this._scene.bpm / this._scene.timeScale,
      );
      this._judgmentDeltas.push({ delta, beat });
    }
    note.setTempJudgment(type, beat);
  }

  createHitEffectsContainer(depth: number) {
    const container = new GameObjects.Container(this._scene);
    container.setDepth(depth);
    this._hitEffectsContainers[depth] = container;
    this._scene.registerNode(container, `hiteffects-${depth}`);
    return container;
  }

  createHitEffects(type: JudgmentType, note: PlainNote | LongNote) {
    const { x, y } = note.judgmentPosition;
    this._hitEffectsContainers[note.note.zIndexHitEffects ?? 7].add(
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

  judgeTap(input: PointerTap) {
    const threshold = this._scene.p(JUDGMENT_THRESHOLD);

    let nearestNote: PlainNote | LongNote | undefined = undefined;
    let minBeat: number = Infinity;
    let minDistance: number = Infinity;
    let minType: number = Infinity;

    const currentJudgeWindow = this._scene.lines
      .flatMap((line) => line.judgeWindow)
      .filter(
        (note) =>
          (Phaser.Math.Distance.BetweenPoints(
            note.judgmentPosition,
            getJudgmentPosition(input, note.line),
          ) *
            1350) /
            this._scene.sys.canvas.width <=
          threshold,
      );
    for (const note of currentJudgeWindow) {
      if (!note.consumeTap || note.hasTapInput || note.judgmentType !== JudgmentType.UNJUDGED) {
        continue;
      }
      const distanceActual =
        (Phaser.Math.Distance.BetweenPoints(note.judgmentPosition, input.position) * 1350) /
        this._scene.sys.canvas.width;
      // if (distanceRelative > threshold) {
      //   this._scene.tweens.add({
      //     targets: [
      //       this._scene.add
      //         .circle(
      //           getJudgmentPosition(input, note.line).x,
      //           getJudgmentPosition(input, note.line).y,
      //           36,
      //           0xff0000,
      //         )
      //         .setAlpha(0.9)
      //         .setDepth(100),
      //     ],
      //     alpha: 0,
      //     duration: 500,
      //   });
      //   continue;
      // }
      // this._scene.tweens.add({
      //   targets: [
      //     this._scene.add
      //       .circle(
      //         getJudgmentPosition(input, note.line).x,
      //         getJudgmentPosition(input, note.line).y,
      //         36,
      //         0x0077ff,
      //       )
      //       .setAlpha(0.9)
      //       .setDepth(100),
      //   ],
      //   alpha: 0,
      //   duration: 500,
      // });
      if (
        minBeat > note.note.startBeat ||
        (equal(minBeat, note.note.startBeat) && minDistance > distanceActual) ||
        (equal(minBeat, note.note.startBeat) &&
          equal(minDistance, distanceActual) &&
          minType > note.note.type)
      ) {
        nearestNote = note;
        minBeat = note.note.startBeat;
        minDistance = distanceActual;
        minType = note.note.type;
        // note.setTint(0x0077ff);
      }
    }
    if (nearestNote) {
      nearestNote.hasTapInput = true;
      if (nearestNote.note.type >= 3) {
        for (const note of currentJudgeWindow) {
          if (!equal(note.note.startBeat, nearestNote.note.startBeat)) continue;
          note.hasTapInput = true;
        }
      }
      // nearestNote.setTint(0x00ff00);
      // this._scene.tweens.add({
      //   targets: [
      //     this._scene.add
      //       .circle(
      //         getJudgmentPosition(input, nearestNote.line).x,
      //         getJudgmentPosition(input, nearestNote.line).y,
      //         36,
      //         0x00ff00,
      //       )
      //       .setAlpha(0.9)
      //       .setDepth(100),
      //   ],
      //   alpha: 0,
      //   duration: 500,
      // });
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
