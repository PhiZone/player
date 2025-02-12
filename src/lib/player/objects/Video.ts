import { GameObjects } from 'phaser';
import { Game } from '../scenes/Game';
import { type AnimatedVariable, type VariableEvent, type Video as VideoType } from '$lib/types';
import { getTimeSec, getEventValue, processEvents, toBeats } from '../utils';

export class Video extends GameObjects.Container {
  private _scene: Game;
  private _data: VideoType;
  private _video: GameObjects.Video;
  private _overlay: GameObjects.Rectangle;
  private _mask: GameObjects.Graphics | null = null;
  private _alphaAnimator: VariableAnimator;
  private _dimAnimator: VariableAnimator;
  private _ready: boolean = false;
  private _shouldPlay: boolean = false;
  private _isPlaying: boolean = false;

  constructor(
    scene: Game,
    data: VideoType,
    callback: (errorMsg?: string, exception?: DOMException | string) => void,
  ) {
    super(scene, 0, 0);
    this._scene = scene;
    this._data = data;
    this._video = new GameObjects.Video(scene, 0, 0, `asset-${data.path}`);
    if (Array.isArray(data.alpha)) {
      this._alphaAnimator = new VariableAnimator(data.alpha);
    }
    if (Array.isArray(data.dim)) {
      this._dimAnimator = new VariableAnimator(data.dim);
    }
    this._video.play();
    this._video.on('metadata', () => {
      this._data.startTimeSec = getTimeSec(scene.bpmList, toBeats(this._data.time));
      this._data.endTimeSec = this._data.startTimeSec + this._video.getDuration();
    });
    this._video.on('unsupported', (_: never, e: DOMException | string) => {
      callback('Unsupported format for video ' + data.path, e);
    });
    // this._video.on('unlocked', (_: never, e: never) => {
    //   console.log('Unlocked', e);
    // });
    this._video.on('error', (_: never, e: DOMException | string) => {
      if (e.toString().startsWith('AbortError')) return;
      callback('An error occurred whilst loading video ' + data.path, e);
    });
    // this._video.on('timeout', () => {
    //   console.log('Timed out');
    // });
    // this._video.on('play', () => {
    //   console.log('Play');
    // });
    // this._video.on('playing', () => {
    //   console.log('Playing');
    // });
    // this._video.on('complete', () => {
    //   console.log('Completed');
    // });
    // this._video.on('loop', () => {
    //   console.log('Looped');
    // });
    // this._video.on('seeking', () => {
    //   console.log('Seeking');
    // });
    // this._video.on('seeked', () => {
    //   console.log('Seeked');
    // });
    // this._video.on('created', () => {
    //   console.log('Created');
    // });
    // this._video.on('stalled', () => {
    //   console.log('Stalled');
    // });
    // this._video.on('stop', () => {
    //   console.log('Stopped');
    // });
    this._video.on('textureready', () => {
      this._overlay = new GameObjects.Rectangle(
        scene,
        0,
        0,
        this._video.displayWidth,
        this._video.displayHeight,
        0x000000,
      );
      if (data.attach) {
        this._scene.lines.at(data.attach.line)?.attachVideo(this);
        if (data.attach.scaleXMode === 2 || data.attach.scaleYMode === 2) {
          this._mask = new GameObjects.Graphics(scene);
          const mask = this._mask.createGeometryMask();
          this._video.setMask(mask);
          this._overlay.setMask(mask);
        }
      }
      setTimeout(() => {
        this._video.pause();
        this._video.seekTo(0);
        this.add(this._video);
        this.add(this._overlay);
        this._video.saveTexture(`asset-${data.path}`, true);
        this.setDepth(data.zIndex !== undefined ? data.zIndex : 1);
        scene.registerNode(this, `video-${data.path}`);
        this._ready = true;
        callback();
      }, 100);
    });
  }

  update(beat: number, timeSec: number) {
    if (!this._ready) return;
    this._shouldPlay =
      timeSec >= 0 && timeSec >= this._data.startTimeSec && timeSec < this._data.endTimeSec;
    this.setVisible(this._shouldPlay);
    if (!this._shouldPlay) {
      this._video.pause();
      this._video.seekTo(0);
      this._isPlaying = false;
      return;
    } else if (!this._isPlaying && this._scene.song.isPlaying) {
      this._video.resume();
      this._isPlaying = true;
    }
    this._video.setPlaybackRate(this._scene.timeScale);
    if (typeof this._data.alpha === 'number') {
      this.setAlpha(this._data.alpha);
    } else {
      this.setAlpha(this._alphaAnimator.handleEvent(beat) as number);
    }
    if (typeof this._data.dim === 'number') {
      this._overlay.setAlpha(this._data.dim);
    } else {
      this._overlay.setAlpha(this._dimAnimator.handleEvent(beat) as number);
    }
    this._scene.positionBackground(this._video, this.scaleMode, undefined, undefined, true);
    this._scene.positionBackground(
      this._overlay,
      'stretch',
      this._video.displayWidth,
      this._video.displayHeight,
      true,
    );
    if (!this._data.attach) {
      this.updateTransform(this._scene.sys.canvas.width / 2, this._scene.sys.canvas.height / 2);
    }
  }

  destroy() {
    this._video.destroy();
    this._overlay.destroy();
    this._mask?.destroy();
    super.destroy();
  }

  pause() {
    this._video.pause();
  }

  resume() {
    this._video.resume();
  }

  setSeek(timeSec: number) {
    const progress = (timeSec - this._data.startTimeSec) / this._video.getDuration();
    if (progress < 0 || progress > 1) return;
    this._video.setCurrentTime(timeSec - this._data.startTimeSec);
  }

  updateAttach(params: {
    x: number;
    y: number;
    rotation: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
    tint: number;
    width: number;
  }) {
    const { x, y, rotation, alpha, scaleX, scaleY, tint, width: lineWidth } = params;
    this.updateTransform(
      x * (this._data.attach?.positionXFactor ?? 1) + this._scene.sys.canvas.width / 2,
      y * (this._data.attach?.positionYFactor ?? 1) + this._scene.sys.canvas.height / 2,
      rotation * (this._data.attach?.rotationFactor ?? 1),
    );
    this.setAlpha(alpha * (this._data.attach?.alphaFactor ?? 1));
    const tintFactor = this._data.attach?.tintFactor ?? 1;
    this._video.setTint(tint * tintFactor + (1 - tintFactor) * 0xffffff);
    if (this._data.attach?.scaleXMode === 1) {
      this.scaleX = scaleX;
      if (this._mask) this._mask.scaleX = scaleX;
    }
    if (this._data.attach?.scaleYMode === 1) {
      this.scaleY = scaleY;
      if (this._mask) this._mask.scaleY = scaleY;
    }
    if (this._mask) {
      const width = this._data.attach?.scaleXMode === 2 ? lineWidth : this._video.displayWidth;
      const height = this._video.displayHeight * (this._data.attach?.scaleYMode === 2 ? scaleY : 1);
      this._mask.clear();
      // this._mask.fillStyle(0xffff00);
      this._mask.fillRect(-width / 2, -height / 2, width, height);
    }
  }

  updateTransform(x: number, y: number, rotation?: number) {
    this.setPosition(x, y);
    this.setRotation(rotation);
    this._mask?.setPosition(x, y);
    this._mask?.setRotation(rotation);
  }

  private get scaleMode() {
    switch (this._data.scale) {
      case 'inside':
        return 'fit';
      case 'fit':
        return 'stretch';
      default:
        return 'envelop';
    }
  }
}

class VariableAnimator {
  private _events: VariableEvent[];
  private _cur: number = 0;

  constructor(events: AnimatedVariable) {
    this._events = events;
    processEvents(this._events);
  }

  handleEvent(beat: number) {
    if (this._events && this._events.length > 0) {
      if (this._cur > 0 && beat <= this._events[this._cur].startBeat) {
        this._cur = 0;
      }
      while (this._cur < this._events.length - 1 && beat > this._events[this._cur + 1].startBeat) {
        this._cur++;
      }
      return getEventValue(beat, this._events[this._cur]);
    } else {
      return undefined;
    }
  }
}
