import type { Sound } from 'phaser';

export class Clock {
  private _sound: Sound.NoAudioSound | Sound.HTML5AudioSound | Sound.WebAudioSound;
  private _soundManager:
    | Sound.NoAudioSoundManager
    | Sound.HTML5AudioSoundManager
    | Sound.WebAudioSoundManager;
  private _reference: {
    songTime: number;
    realTime: DOMHighResTimeStamp;
    rate: number;
    biases: number[];
    biasSum: number;
  };
  private _completeCallback: () => void;
  private _time: number = 0;
  private _completed: boolean = false;

  constructor(
    sound: Sound.NoAudioSound | Sound.HTML5AudioSound | Sound.WebAudioSound,
    soundManager:
      | Sound.NoAudioSoundManager
      | Sound.HTML5AudioSoundManager
      | Sound.WebAudioSoundManager,
    completeCallback: () => void,
  ) {
    this._sound = sound;
    this._soundManager = soundManager;
    this._completeCallback = completeCallback;
    this.sync();
    this.update();
  }

  play() {
    this._sound.play();
    this.sync();
  }

  pause() {
    this._sound.pause();
    this.sync();
  }

  resume() {
    this._sound.resume();
    this.sync();
  }

  setSeek(time: number) {
    this._sound.setSeek(time);
    this.sync();
  }

  setRate(rate: number) {
    this._sound.setRate(rate);
    this.sync();
  }

  sync() {
    this._reference = {
      songTime: this._sound.seek,
      realTime: performance.now(),
      rate: this._sound.isPlaying ? this._soundManager.rate * this._sound.rate : 0,
      biases: [],
      biasSum: 0,
    };
  }

  update() {
    const now = (performance.now() - this._reference.realTime) / 1000;
    const bias = now * this._reference.rate - this._sound.seek;
    this._reference.biases.push(bias);
    this._reference.biasSum += bias;
    while (this._reference.biases.length > 60) {
      this._reference.biasSum -= this._reference.biases.shift()!;
    }
    const diff =
      now - this._reference.biasSum / this._reference.biases.length - this._reference.songTime;
    this._time = this._reference.songTime + diff * this._reference.rate;
  }

  setTime(time: number) {
    this._time = time;
    if (this._time < 0) this._time = 0;
    if (this._time >= this._sound.duration) {
      this._time = this._sound.duration;
      if (!this._completed) this._completeCallback();
    }
  }

  public get seek() {
    return this._time;
  }
}
