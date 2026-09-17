import { GameObjects } from 'phaser';
import { JudgmentType } from '$lib/types';
import type { OrdinaryParticle, PolygonParticle } from '$lib/types';
import type { Game } from '../scenes/Game';
import {
  HIT_EFFECTS_PARTICLE_SIZE,
  HIT_EFFECTS_PARTICLE_SPREAD_RANGE,
  HIT_EFFECTS_SIZE,
} from '../constants';

type ParticleObject = GameObjects.Arc | GameObjects.Rectangle | GameObjects.Polygon;

interface PooledParticle {
  obj: ParticleObject;
  tint: number;
}

interface ParticleState {
  obj: ParticleObject;
  x0: number;
  y0: number;
  tx: number;
  ty: number;
  age: number;
}

/**
 * Particle lifecycle is 600ms: the alpha tween (Cubic.easeIn over 600ms)
 * finished first and destroyed the particle; the scale tween ran 300ms up
 * (Cubic.easeOut) and 500ms down (Cubic.easeIn, delayed 300ms); the position
 * tween ran the full 800ms on 'Quint' (ease-in-out).
 */
const PARTICLE_LIFETIME = 600;

/**
 * Advances pooled hit particles manually. The previous implementation drove
 * each particle with four tweens, so dense autoplay sections kept hundreds of
 * tween objects alive and paid tween construction (property resolution, list
 * inserts) on every hit. Rendering is unchanged: the same pooled GameObjects
 * inside the same container, moved along the exact same easing curves.
 */
export class HitParticleLayer {
  private _scene: Game;
  private _container: GameObjects.Container;
  private _pref: OrdinaryParticle | PolygonParticle;
  private _live: ParticleState[] = [];
  private _pool: PooledParticle[] = [];
  private _baseScale: number | undefined;

  constructor(
    scene: Game,
    container: GameObjects.Container,
    pref: OrdinaryParticle | PolygonParticle,
  ) {
    this._scene = scene;
    this._container = container;
    this._pref = pref;
  }

  spawn(x: number, y: number, color: number, scale: number) {
    if (this._baseScale === undefined) {
      this._baseScale = scale * HIT_EFFECTS_PARTICLE_SIZE;
    }
    const spread = scale * HIT_EFFECTS_PARTICLE_SPREAD_RANGE;
    for (let i = 0; i < this._pref.count; i++) {
      const range = Math.random() * spread;
      const angle = Math.random() * Math.PI * 2;
      const pooled = this._acquire(color, x, y);
      const obj = pooled.obj;
      obj.visible = true;
      obj.setPosition(x, y);
      obj.setScale(0);
      obj.setAlpha(1);
      this._live.push({
        obj,
        x0: x,
        y0: y,
        tx: x + range * Math.cos(angle),
        ty: y + range * Math.sin(angle),
        age: 0,
      });
    }
  }

  private _acquire(color: number, x: number, y: number): PooledParticle {
    const pooled = this._pool.pop();
    if (pooled) {
      if (pooled.tint !== color) {
        pooled.obj.setFillStyle(color);
        pooled.tint = color;
      }
      return pooled;
    }
    const pref = this._pref;
    const scale = this._baseScale!;
    let obj: ParticleObject;
    if (pref.style === 'polygon') {
      obj = new GameObjects.Polygon(
        this._scene,
        x,
        y,
        (pref as PolygonParticle).points.flat().map((v) => v * scale),
        color,
      );
    } else if (pref.style === 'circle') {
      obj = new GameObjects.Arc(
        this._scene,
        x,
        y,
        scale * Math.SQRT1_2,
        undefined,
        undefined,
        undefined,
        color,
      );
    } else {
      obj = new GameObjects.Rectangle(this._scene, x, y, scale, scale, color);
      obj.setOrigin(0.5);
    }
    this._container.add(obj);
    return { obj, tint: color };
  }

  tick(delta: number) {
    const live = this._live;
    let w = 0;
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      p.age += delta;
      if (p.age >= PARTICLE_LIFETIME) {
        p.obj.visible = false;
        this._pool.push({ obj: p.obj, tint: 0 });
        continue;
      }
      const t = p.age / 800;
      // 'Quint' resolves to Quintic.easeOut in Phaser's EaseMap.
      const posT = 1 - Math.pow(1 - t, 5);
      p.obj.setPosition(p.x0 + (p.tx - p.x0) * posT, p.y0 + (p.ty - p.y0) * posT);
      const sT =
        p.age < 300 ? 1 - Math.pow(1 - p.age / 300, 3) : 1 - Math.pow((p.age - 300) / 500, 3);
      p.obj.setScale(Math.max(sT, 0));
      p.obj.setAlpha(Math.max(1 - Math.pow(p.age / PARTICLE_LIFETIME, 3), 0));
      live[w++] = p;
    }
    live.length = w;
  }
}

/**
 * One hit-effect sprite. Reused by {@link HitEffectsPool}: after the animation
 * finishes the sprite is hidden and returned to the pool instead of destroyed,
 * so dense autoplay no longer allocates a Sprite (and its event listeners)
 * on every judgment.
 */
export class HitEffects extends GameObjects.Sprite {
  private _scene: Game;
  private _color: number = 0xffffff;
  private _pool: HitEffectsPool | null = null;
  private readonly _onAnimComplete = () => {
    this._release();
  };

  constructor(scene: Game) {
    super(scene, 0, 0, 'hit-effects');
    this._scene = scene;
    this.setScale((256 / this.width) * scene.p(HIT_EFFECTS_SIZE * scene.preferences.noteSize));
    this.setVisible(false);
    this.setActive(false);
  }

  /** Plays from a pool entry; returns false if this sprite is already live. */
  playPooled(
    pool: HitEffectsPool,
    x: number,
    y: number,
    type: JudgmentType,
    tint: number | undefined,
    layer?: HitParticleLayer,
  ) {
    if (this._pool) return false;
    this._pool = pool;
    this.setPosition(x, y);
    this.setVisible(true);
    this.setActive(true);
    this.setColor(this._scene.respack.getHitEffectsColor(type));
    if (tint !== undefined) this.setTint(tint);
    else this.clearTint();
    this.off('animationcomplete', this._onAnimComplete);
    this.once('animationcomplete', this._onAnimComplete);
    this.play('hit-effects');
    if (layer) layer.spawn(this.x, this.y, tint ?? this._color, this.scaleX);
    return true;
  }

  private _release() {
    this.stop();
    this.setVisible(false);
    this.setActive(false);
    const pool = this._pool;
    this._pool = null;
    pool?.onRelease(this);
  }

  setColor(color: { hex: number; alpha: number }) {
    this._color = color.hex;
    this.setTint(this._color);
    this.setAlpha(color.alpha);
  }
}

/**
 * Per-depth pool of hit-effect sprites. Sprites stay parented to their
 * container for the whole playthrough; only visibility/animation state is
 * recycled.
 */
export class HitEffectsPool {
  private _scene: Game;
  private _free: HitEffects[] = [];

  constructor(scene: Game) {
    this._scene = scene;
  }

  spawn(
    container: GameObjects.Container,
    x: number,
    y: number,
    type: JudgmentType,
    tint: number | undefined,
    layer?: HitParticleLayer,
  ) {
    let fx = this._free.pop();
    if (!fx) {
      fx = new HitEffects(this._scene);
      container.add(fx);
    }
    fx.playPooled(this, x, y, type, tint, layer);
  }

  onRelease(fx: HitEffects) {
    this._free.push(fx);
  }

  destroy() {
    this._free.length = 0;
  }
}
