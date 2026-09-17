import type { Sound } from 'phaser';
import type { Game } from '../scenes/Game';

type PlayableSound = Sound.NoAudioSound | Sound.HTML5AudioSound | Sound.WebAudioSound;

/** Concurrent hitsound instances allowed per key before we steal the oldest. */
const MAX_PER_KEY = 12;

/**
 * Pooled hitsound playback, keyed by Phaser sound key.
 *
 * Previously every judgment called `sound.add()` + `play()`, which allocated
 * a new WebAudio node graph per hit and fed the 10s full-GC freezes seen on
 * dense charts. Sounds are created lazily, reused when idle, grown up to
 * {@link MAX_PER_KEY} under burst, then round-robin stolen (stop + replay)
 * so allocation stays bounded.
 */
export class HitsoundPool {
  private _scene: Game;
  private _pools = new Map<string, PlayableSound[]>();
  private _stealCursors = new Map<string, number>();

  constructor(scene: Game) {
    this._scene = scene;
  }

  play(key: string, volume: number) {
    if (volume <= 0) return;
    let pool = this._pools.get(key);
    if (!pool) {
      pool = [];
      this._pools.set(key, pool);
    }

    let sound: PlayableSound | undefined;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      if (!s.isPlaying && !s.isPaused) {
        sound = s;
        break;
      }
    }
    if (!sound) {
      if (pool.length < MAX_PER_KEY) {
        sound = this._scene.sound.add(key);
        pool.push(sound);
      } else {
        const cursor = this._stealCursors.get(key) ?? 0;
        sound = pool[cursor % pool.length];
        this._stealCursors.set(key, cursor + 1);
      }
    }

    sound.setVolume(volume);
    if (sound.isPlaying || sound.isPaused) sound.stop();
    sound.play();
  }

  destroy() {
    for (const pool of this._pools.values()) {
      for (const sound of pool) {
        try {
          sound.destroy();
        } catch {
          // manager may already be tearing down
        }
      }
    }
    this._pools.clear();
    this._stealCursors.clear();
  }
}
