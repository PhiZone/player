import type { Game } from '../scenes/Game';
import { GameStatus } from '$lib/types';

export class KeyboardHandler {
  private _scene: Game;
  private _increment: number = 5;

  constructor(scene: Game) {
    this._scene = scene;

    if (this._scene.autoplay) {
      this._scene.input.keyboard?.on('keydown-SPACE', this.handleSpaceDown, this);
      this._scene.input.keyboard?.on('keydown-LEFT', this.handleLeftArrowDown, this);
      this._scene.input.keyboard?.on('keydown-RIGHT', this.handleRightArrowDown, this);
      this._scene.input.keyboard?.on('keydown-SHIFT', this.handleShiftDown, this);
      this._scene.input.keyboard?.on('keyup-SHIFT', this.handleShiftUp, this);
    }
    this._scene.input.keyboard?.on('keyup-ESC', this.handleEscapeUp, this);
  }

  handleSpaceDown() {
    if (this._scene.status === GameStatus.PLAYING) {
      this._scene.pause(true);
    } else if (this._scene.status === GameStatus.PAUSED) {
      this._scene.resume();
    }
  }

  handleLeftArrowDown() {
    this.setSeek(Math.max(0, this._scene.song.seek - this._increment * this._scene.timeScale));
  }

  handleRightArrowDown() {
    this.setSeek(
      Math.min(
        this._scene.song.duration,
        this._scene.song.seek + this._increment * this._scene.timeScale,
      ),
    );
  }

  setSeek(value: number) {
    const pauseAndResume = this._scene.status === GameStatus.PLAYING;
    if (pauseAndResume) this._scene.pause();
    this._scene.setSeek(value);
    if (pauseAndResume) this._scene.resume();
  }

  handleShiftDown() {
    this._increment = 0.1;
  }

  handleShiftUp() {
    this._increment = 5;
  }

  handleEscapeUp() {
    if (this._scene.status === GameStatus.PLAYING) {
      this._scene.pause();
    } else if (this._scene.status === GameStatus.PAUSED) {
      this._scene.resume();
    }
  }
}
