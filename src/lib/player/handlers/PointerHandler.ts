import type { Input } from 'phaser';
import { FLICK_VELOCTY_THRESHOLD, JUDGMENT_THRESHOLD } from '../constants';
import type { LongNote } from '../objects/LongNote';
import type { PlainNote } from '../objects/PlainNote';
import type { Game } from '../scenes/Game';
import { GameStatus, type PointerDrag } from '$lib/types';
import { getJudgmentPosition } from '../utils';

export class PointerHandler {
  private _scene: Game;
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
    const tap = {
      id: pointer.id,
      time: this._scene.timeSec,
      position,
      distance: Infinity,
      spaceTimeDistance: Infinity,
    };
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
    //       .bitmapText(position.x, position.y, 'Outfit', (pointer.id % 100).toString(), 24)
    //       .setOrigin(0.5, 0.5)
    //       .setDepth(101),
    //   ],
    //   alpha: 0,
    //   ease: 'Cubic.easeIn',
    //   duration: 200,
    // });
    this._scene.judgment.judgeTap(tap);
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
    //       .bitmapText(position.x, position.y, 'Outfit', velocityMagnitude.toFixed(1), 24)
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
        this._pointerDrags[index].velocityConsumed.dot(velocity) < 0.6)
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
    this._pointerDrags
      .map((input) => this._scene.input.manager.pointers.at(input.id))
      .forEach((pointer) => {
        if (!pointer || pointer.isDown) return;
        this.removePointer(pointer);
      });
  }

  findDrag(note: PlainNote | LongNote, requireVelocity: boolean = false) {
    const notePosition = note.judgmentPosition;
    this._pointerDrags.forEach((input) => {
      input.distance = Phaser.Math.Distance.BetweenPoints(
        notePosition,
        getJudgmentPosition(input, note.line),
      );
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
    this._pointerDrags = this._pointerDrags.filter((input) => input.id !== pointer.id);
  }

  consumeDrag(id: number) {
    const index = this._pointerDrags.findIndex((input) => input.id === id);
    this._pointerDrags[index].velocityConsumed = this._pointerDrags[index].velocity.clone();
  }
  public get pointerDrags() {
    return this._pointerDrags;
  }

  reset() {
    this._pointerDrags = [];
  }
}
