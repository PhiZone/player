import type { Game } from '../scenes/Game';
import { GameStatus } from '$lib/types';
import type { PlainNote } from '../objects/PlainNote';
import type { LongNote } from '../objects/LongNote';
import { KEYBOARD_INPUT_REGEX } from '../constants';

export class KeyboardHandler {
  private _scene: Game;
  private _increment: number = 5;
  private _isShiftDown: boolean = false;
  private _keysDown: Set<string> = new Set();

  constructor(scene: Game) {
    this._scene = scene;

    if (this._scene.autoplay || this._scene.practice) {
      this._scene.input.keyboard?.on('keydown-SPACE', this.handleSpaceDown, this);
      this._scene.input.keyboard?.on('keydown-LEFT', this.handleLeftArrowDown, this);
      this._scene.input.keyboard?.on('keydown-RIGHT', this.handleRightArrowDown, this);
      this._scene.input.keyboard?.on('keydown-SHIFT', this.handleShiftDown, this);
      this._scene.input.keyboard?.on('keyup-SHIFT', this.handleShiftUp, this);
    }
    this._scene.input.keyboard?.on('keyup-ESC', this.handleEscapeUp, this);
    this._scene.input.keyboard?.on('keydown', this.handleDown, this);
    this._scene.input.keyboard?.on('keyup', this.handleUp, this);
  }

  findDrag(_note: PlainNote | LongNote, _requireVelocity: boolean = false) {
    return this._keysDown.size > 0;
  }

  reset() {
    this._keysDown.clear();
  }

  handleDown(e: KeyboardEvent) {
    if (e.repeat) {
      return;
    }
    if (!KEYBOARD_INPUT_REGEX.test(e.key)) {
      return;
    }
    if (this._scene.autoplay || this._scene.status !== GameStatus.PLAYING) return;
    this._keysDown.add(e.key);
    console.debug('+', e.key, this._keysDown);
    this._scene.judgment.judgeTap();
  }

  handleUp(e: KeyboardEvent) {
    if (e.repeat) {
      return;
    }
    if (!KEYBOARD_INPUT_REGEX.test(e.key)) {
      return;
    }
    if (this._scene.autoplay || this._scene.status !== GameStatus.PLAYING) return;
    this._keysDown.delete(e.key);
    console.debug('-', e.key, this._keysDown);
  }

  handleSpaceDown() {
    if (this._scene.status === GameStatus.PLAYING) {
      if (this._scene.practice && !this._isShiftDown) return;
      this._scene.pause(true);
    } else if (this._scene.status === GameStatus.PAUSED) {
      this._scene.resume();
    }
  }

  handleLeftArrowDown() {
    this.setSeek(Math.max(0, this._scene.clock.seek - this._increment * this._scene.timeScale));
  }

  handleRightArrowDown() {
    this.setSeek(
      Math.min(
        this._scene.song.duration,
        this._scene.clock.seek + this._increment * this._scene.timeScale,
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
    this._isShiftDown = true;
    this._increment = 0.1;
  }

  handleShiftUp() {
    this._isShiftDown = false;
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
