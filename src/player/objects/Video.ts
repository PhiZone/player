import { GameObjects } from 'phaser';
import type { Game } from '../scenes/Game';
import { type AnimatedVariable, type VariableEvent, type Video as VideoType } from '../types';
import { getTimeSec, getValue, processEvents, toBeats } from '../utils';

export class Video extends GameObjects.Container {
  private _scene: Game;
  private _data: VideoType;
  private _video: GameObjects.Video;
  private _overlay: GameObjects.Rectangle;
  private _alphaAnimator: VariableAnimator;
  private _dimAnimator: VariableAnimator;

  constructor(scene: Game, data: VideoType, successCallback: () => void) {
    super(scene, 0, 0);
    this._scene = scene;
    this._data = data;
    this._video = new GameObjects.Video(scene, 0, 0, `asset-${data.path}`);
    this._overlay = new GameObjects.Rectangle(
      scene,
      0,
      0,
      scene.sys.canvas.width,
      scene.sys.canvas.height,
      0x000000,
    );
    this.setDepth(1);
    this._video.play();
    this._video.on('metadata', () => {
      this._data.startTimeSec = getTimeSec(scene.bpmList, toBeats(this._data.time));
      this._data.endTimeSec = this._data.startTimeSec + this._video.getDuration();
    });
    this._video.on('textureready', () => {
      this._video.stop();
      this.add(this._video);
      this.add(this._overlay);
      scene.register(this);
      successCallback();
    });
  }

  update(beat: number, timeSec: number) {
    this.setVisible(
      timeSec > 0 && timeSec >= this._data.startTimeSec && timeSec < this._data.endTimeSec,
    );
    if (!this.visible) {
      this._video.stop();
    } else if (!this._video.isPlaying() && this._scene.song.isPlaying) {
      this._video.play();
    }
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
    this._scene.positionBackground(this._video, this.scaleMode);
    this._scene.positionBackground(
      this._overlay,
      'stretch',
      this._video.displayWidth,
      this._video.displayHeight,
    );
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
      return getValue(beat, this._events[this._cur]);
    } else {
      return undefined;
    }
  }
}
