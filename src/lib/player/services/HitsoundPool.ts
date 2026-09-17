/**
 * Pooled hitsound playback using HTMLAudioElements.
 *
 * Phaser's WebAudioSound allocates a new AudioBufferSourceNode on every
 * play() (Web Audio API one-shot rule), which fed frequent partial GCs on
 * dense autoplay. HTMLAudioElements can be paused and seeked back to 0 and
 * replayed without creating a new source graph.
 */
export class HitsoundPool {
  private _pools = new Map<string, HTMLAudioElement[]>();
  private _urls = new Map<string, string>();
  private _steal = new Map<string, number>();

  register(key: string, url: string) {
    this._urls.set(key, url);
  }

  play(key: string, volume: number) {
    if (volume <= 0) return;
    const url = this._urls.get(key);
    if (!url) return;
    let pool = this._pools.get(key);
    if (!pool) {
      pool = [];
      this._pools.set(key, pool);
    }

    let el: HTMLAudioElement | undefined;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].paused || pool[i].ended) {
        el = pool[i];
        break;
      }
    }
    if (!el) {
      if (pool.length < 8) {
        el = new Audio(url);
        el.preload = 'auto';
        pool.push(el);
      } else {
        const cursor = this._steal.get(key) ?? 0;
        el = pool[cursor % pool.length];
        this._steal.set(key, cursor + 1);
      }
    }

    el.volume = Math.min(1, Math.max(0, volume));
    try {
      el.currentTime = 0;
    } catch {
      // not seekable yet
    }
    void el.play().catch(() => {});
  }

  destroy() {
    for (const pool of this._pools.values()) {
      for (const el of pool) {
        el.pause();
        el.src = '';
      }
    }
    this._pools.clear();
    this._urls.clear();
    this._steal.clear();
  }
}
