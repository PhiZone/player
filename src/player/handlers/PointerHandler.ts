import { dot } from 'mathjs';
import type { Input } from 'phaser';
import { FLICK_VELOCTY_THRESHOLD, JUDGMENT_THRESHOLD } from '../constants';
import type { Line } from '../objects/Line';
import type { LongNote } from '../objects/LongNote';
import type { PlainNote } from '../objects/PlainNote';
import type { Game } from '../scenes/Game';
import { GameStatus, type PointerTap, type PointerDrag } from '../types';
import { getTimeSec } from '../utils';

export class PointerHandler {
  private _scene: Game;
  private _pointerTaps: PointerTap[] = [];
  private _pointerDrags: PointerDrag[] = [];

  constructor(scene: Game) {
    this._scene = scene;
    this._scene.input.on('pointerdown', this.updateTap, this);
    this._scene.input.on('pointermove', this.updateMove, this);
    this._scene.input.on('pointerup', this.removePointer, this);
  }

  updateTap(pointer: Input.Pointer) {
    if (
      this._scene.autoplay ||
      this._scene.status !== GameStatus.PLAYING ||
      this._scene.gameUI.pause.isInvokeable(pointer.x, pointer.y)
    )
      return;
    const position = new Phaser.Math.Vector2(pointer.x, pointer.y);
    this._pointerTaps.push({
      id: pointer.id,
      time: this._scene.timeSec,
      position,
      distance: Infinity,
      spaceTimeDistance: Infinity,
    });
    this._pointerDrags.push({
      id: pointer.id,
      time: this._scene.timeSec,
      position,
      velocity: Phaser.Math.Vector2.ZERO,
      velocityConsumed: null,
      distance: Infinity,
    });
    // this._scene.tweens.add({
    //   targets: [
    //     this._scene.add.circle(position.x, position.y, 36, 0x1cd6ce).setDepth(100),
    //     this._scene.add
    //       .text(position.x, position.y, (pointer.id % 100).toString(), { fontSize: 24 })
    //       .setOrigin(0.5, 0.5)
    //       .setDepth(101),
    //   ],
    //   alpha: 0,
    //   ease: 'Cubic.easeIn',
    //   duration: 200,
    // });
  }

  updateMove(pointer: Input.Pointer) {
    if (this._scene.autoplay || this._scene.status !== GameStatus.PLAYING) return;
    const index = this._pointerDrags.findIndex((input) => input.id === pointer.id);
    if (index === -1) {
      return;
    }
    const position = new Phaser.Math.Vector2(pointer.x, pointer.y);
    const velocity = pointer.velocity;
    const velocityMagnitude = velocity
      .multiply(
        new Phaser.Math.Vector2(
          1350 / this._scene.sys.canvas.width,
          900 / this._scene.sys.canvas.height,
        ),
      )
      .length();
    velocity.normalize();
    this._pointerDrags[index].time = this._scene.timeSec;
    this._pointerDrags[index].position = position;
    this._pointerDrags[index].velocity =
      velocityMagnitude >= FLICK_VELOCTY_THRESHOLD ? velocity : Phaser.Math.Vector2.ZERO;
    // this._scene.tweens.add({
    //   targets: [
    //     this._scene.add
    //       .circle(
    //         position.x,
    //         position.y,
    //         36,
    //         velocityMagnitude >= FLICK_VELOCTY_THRESHOLD ? 0xd61c4e : 0xfedb39,
    //       )
    //       .setDepth(100),
    //     this._scene.add
    //       .text(position.x, position.y, velocityMagnitude.toFixed(1), { fontSize: 24 })
    //       .setOrigin(0.5, 0.5)
    //       .setDepth(100),
    //   ],
    //   alpha: 0,
    //   ease: 'Cubic.easeIn',
    //   duration: 50,
    // });
    if (
      velocityMagnitude < FLICK_VELOCTY_THRESHOLD ||
      (this._pointerDrags[index].velocityConsumed &&
        this._pointerDrags[index].velocityConsumed.dot(velocity) < 0.5)
    ) {
      this._pointerDrags[index].velocityConsumed = null;
    }
  }

  update(delta: number) {
    const timeSec = this._scene.timeSec;
    this.pointerDrags
      .filter((input) => input.time < timeSec - delta / 100)
      .forEach((input) => {
        input.time = timeSec;
        input.velocity = Phaser.Math.Vector2.ZERO;
        input.velocityConsumed = null;
      });
    this.pointerTaps
      .map((input) => this._scene.input.manager.pointers.at(input.id))
      .forEach((pointer) => {
        if (!pointer || pointer.isDown) return;
        this.removePointer(pointer);
      });
  }

  findTap(note: PlainNote | LongNote, rangeEarliest: number, rangeLatest: number) {
    const notePosition = note.judgmentPosition;
    const taps = this._pointerTaps.filter(
      (input) => input.time >= rangeEarliest && input.time <= rangeLatest,
    );
    taps.forEach((input) => {
      input.distance =
        (Phaser.Math.Distance.BetweenPoints(
          notePosition,
          this.getJudgmentPosition(input, note.line),
        ) *
          1350) /
        this._scene.sys.canvas.width;
      input.spaceTimeDistance =
        input.distance ** 2 +
        ((input.time - getTimeSec(this._scene.bpmList, note.note.startBeat)) * 100) ** 2;
    });
    const tap = taps
      .filter((input) => input.distance <= this._scene.p(JUDGMENT_THRESHOLD))
      .sort((a, b) => a.distance - b.distance)[0];
    if (tap) this.consumeTap(tap.id);
    return tap;
  }

  findDrag(note: PlainNote | LongNote, requireVelocity: boolean = false) {
    const notePosition = note.judgmentPosition;
    this._pointerDrags.forEach((input) => {
      input.distance = Phaser.Math.Distance.BetweenPoints(
        notePosition,
        this.getJudgmentPosition(input, note.line),
      );
      this._scene.tweens.add({
        targets: this._scene.add
          .line(
            0,
            0,
            notePosition.x,
            notePosition.y,
            this.getJudgmentPosition(input, note.line).x,
            this.getJudgmentPosition(input, note.line).y,
          )
          .setDepth(100),
        alpha: 0,
        ease: 'Cubic.easeIn',
        duration: 200,
      });
    });
    const drag = this._pointerDrags
      .filter((input) => {
        return (
          input.distance <= this._scene.p(JUDGMENT_THRESHOLD) &&
          (!requireVelocity ||
            (input.velocity.lengthSq() > 0 &&
              (!input.velocityConsumed || input.velocity.dot(input.velocityConsumed) < 0)))
        );
      })
      .sort((a, b) => a.distance - b.distance)[0];
    if (drag && requireVelocity) this.consumeDrag(drag.id);
    return drag;
  }

  consumeTap(id: number) {
    this._pointerTaps = this._pointerTaps.filter((input) => input.id !== id);
  }

  removePointer(pointer: Input.Pointer) {
    if (this._scene.autoplay || this._scene.status !== GameStatus.PLAYING) return;
    // this._scene.tweens.add({
    //   targets: [
    //     this._scene.add.circle(pointer.position.x, pointer.position.y, 36, 0x2f628c).setDepth(100),
    //     this._scene.add
    //       .text(pointer.position.x, pointer.position.y, (pointer.id % 100).toString(), {
    //         fontSize: 24,
    //       })
    //       .setOrigin(0.5, 0.5)
    //       .setDepth(101),
    //   ],
    //   alpha: 0,
    //   ease: 'Cubic.easeIn',
    //   duration: 200,
    // });
    this._pointerTaps = this._pointerTaps.filter((input) => input.id !== pointer.id);
    this._pointerDrags = this._pointerDrags.filter((input) => input.id !== pointer.id);
  }

  consumeDrag(id: number) {
    const index = this._pointerDrags.findIndex((input) => input.id === id);
    this._pointerDrags[index].velocityConsumed = this._pointerDrags[index].velocity.clone();
  }

  getJudgmentPosition(input: PointerTap | PointerDrag, line: Line) {
    const vector = line.vector;
    vector.scale(dot([input.position.x - line.x, input.position.y - line.y], [vector.x, vector.y]));
    vector.add(new Phaser.Math.Vector2(line.x, line.y));
    return vector;
  }

  public get pointerTaps() {
    return this._pointerTaps;
  }

  public get pointerDrags() {
    return this._pointerDrags;
  }
}
