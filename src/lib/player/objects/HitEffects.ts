import { GameObjects } from 'phaser';
import { JudgmentType } from '$lib/types';
import type { Game } from '../scenes/Game';
import {
  HIT_EFFECTS_PARTICLE_SIZE,
  HIT_EFFECTS_PARTICLE_SPREAD_RANGE,
  HIT_EFFECTS_SIZE,
} from '../constants';

export class HitEffects extends GameObjects.Sprite {
  private _scene: Game;
  private _color: number;

  constructor(scene: Game, x: number, y: number, type: JudgmentType) {
    super(scene, x, y, 'hit-effects');

    this._scene = scene;
    this.setScale((256 / this.width) * scene.p(HIT_EFFECTS_SIZE * scene.preferences.noteSize));
    this.setColor(scene.respack.getHitEffectsColor(type));
  }

  hit(tint?: number) {
    if (tint) {
      this.setTint(tint);
    }
    this.play('hit-effects');
    this.once('animationcomplete', () => {
      this.destroy();
    });
    return [
      this,
      ...Array(this._scene.respack.hitEffects.particle.count)
        .fill(null)
        .map(() => this.particle(tint)),
    ];
  }

  particle(tint?: number) {
    const pref = this._scene.respack.hitEffects.particle;
    const particle = (
      pref.style === 'polygon'
        ? new GameObjects.Polygon(
            this._scene,
            this.x,
            this.y,
            pref.points.flat().map((v) => v * this.scale * HIT_EFFECTS_PARTICLE_SIZE),
            tint ?? this._color,
          )
        : pref.style === 'circle'
          ? new GameObjects.Arc(
              this._scene,
              this.x,
              this.y,
              this.scale * HIT_EFFECTS_PARTICLE_SIZE * Math.SQRT1_2,
              undefined,
              undefined,
              undefined,
              tint ?? this._color,
            )
          : new GameObjects.Rectangle(
              this._scene,
              this.x,
              this.y,
              this.scale * HIT_EFFECTS_PARTICLE_SIZE,
              this.scale * HIT_EFFECTS_PARTICLE_SIZE,
              tint ?? this._color,
            )
    )
      .setOrigin(0.5)
      .setScale(0);
    const range = this.scale * HIT_EFFECTS_PARTICLE_SPREAD_RANGE;
    this.scene.tweens.add({
      targets: particle,
      x: this.x + Math.random() * range - range / 2,
      y: this.y + Math.random() * range - range / 2,
      ease: 'Quint',
      duration: 800,
      repeat: 0,
    });
    this.scene.tweens.add({
      targets: particle,
      scale: 1,
      ease: 'Cubic.easeOut',
      duration: 300,
      repeat: 0,
    });
    this.scene.tweens.add({
      targets: particle,
      scale: 0,
      ease: 'Cubic.easeIn',
      duration: 500,
      delay: 300,
      repeat: 0,
    });
    this.scene.tweens.add({
      targets: particle,
      alpha: 0,
      ease: 'Cubic.easeIn',
      duration: 600,
      repeat: 0,
      onComplete: () => {
        particle.destroy();
      },
    });
    return particle;
  }

  setColor(color: { hex: number; alpha: number }) {
    this._color = color.hex;
    this.setTint(this._color);
    this.setAlpha(color.alpha);
  }
}
