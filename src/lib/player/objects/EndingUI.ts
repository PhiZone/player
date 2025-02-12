import { GameObjects, Sound } from 'phaser';
import type { Game } from '../scenes/Game';
import { FONT_FAMILY } from '../constants';
import type { Grade } from '$lib/types';
import { pad, position } from '../utils';
import { EventBus } from '../EventBus';
import { Capacitor } from '@capacitor/core';

export class EndingUI extends GameObjects.Container {
  private _scene: Game;
  private _innerContainer: GameObjects.Container;
  private _sound: Sound.NoAudioSound | Sound.HTML5AudioSound | Sound.WebAudioSound;
  private _illustration: GameObjects.Container;
  private _overlay: GameObjects.Rectangle;
  private _grade: GameObjects.Image;
  private _score: ScoreBoard;
  private _accuracy: DataBoard;
  private _maxCombo: DataBoard;
  private _stdDev: DataBoard;
  private _perfect: DataBoard;
  private _good: DataBoard;
  private _bad: DataBoard;
  private _miss: DataBoard;
  private _early: DataBoard;
  private _late: DataBoard;
  private _tweening: boolean = true;
  private _timer: NodeJS.Timeout | undefined;
  private _loopsToRecord: number;

  constructor(scene: Game, loopsToRecord: number) {
    super(scene, scene.w(0), scene.h(-500) + scene.d(0.41));

    this._scene = scene;
    const stats = scene.statistics.stats;
    this._innerContainer = this.createInnerContainer();
    this._score = this.createScore(stats.score);
    this._accuracy = this.createDataBoard(
      -scene.d(32 / 9 - 1.9),
      -scene.d(0.97),
      'ACCURACY',
      stats.accuracy.toLocaleString(undefined, {
        style: 'percent',
        minimumFractionDigits: 2,
      }),
    );
    this._maxCombo = this.createDataBoard(
      scene.d(((32 / 9 + (32 / 9 - 1.9)) * 1) / 3 - (32 / 9 - 1.9)),
      -scene.d(0.97),
      'MAX COMBO',
      stats.maxCombo.toString(),
    );
    this._stdDev = this.createDataBoard(
      scene.d(((32 / 9 + (32 / 9 - 1.9)) * 2) / 3 - (32 / 9 - 1.9)),
      -scene.d(0.97),
      'STD DEVIATION',
      `${stats.displayStdDev.toFixed(3)} ms`,
    );
    this._perfect = this.createDataBoard(
      scene.d(-32 / 9),
      scene.d(1.42),
      'PERFECT',
      stats.perfect.toString(),
    );
    this._good = this.createDataBoard(
      scene.d(((64 / 9) * 1) / 5 - 32 / 9),
      scene.d(1.42),
      'GOOD',
      (stats.goodEarly + stats.goodLate).toString(),
    );
    this._bad = this.createDataBoard(
      scene.d(((64 / 9) * 2) / 5 - 32 / 9),
      scene.d(1.42),
      'BAD',
      stats.bad.toString(),
    );
    this._miss = this.createDataBoard(
      scene.d(((64 / 9) * 3) / 5 - 32 / 9),
      scene.d(1.42),
      'MISS',
      stats.miss.toString(),
    );
    this._early = this.createDataBoard(
      scene.d(((64 / 9) * 4) / 5 - 32 / 9),
      scene.d(1.4),
      'EARLY',
      stats.goodEarly.toString(),
      scene.d(64 / 9 / 5),
    );
    this._late = this.createDataBoard(
      scene.d(((64 / 9) * 4) / 5 - 32 / 9),
      scene.d(1.65),
      'LATE',
      stats.goodLate.toString(),
      scene.d(64 / 9 / 5),
    );
    this._illustration = this.createIllustration();
    this._overlay = this.createOverlay();
    this._grade = this.createGrade(stats.grade);
    this._loopsToRecord = loopsToRecord;

    position(
      [this._accuracy, this._maxCombo, this._stdDev],
      -this._scene.d(32 / 9 - 1.9),
      this._scene.d(32 / 9),
    );
    position(
      [this._perfect, this._good, this._bad, this._miss, this._early, this._late],
      -this._scene.d(32 / 9),
      this._scene.d(32 / 9),
      5,
    );
    this.setVisible(false);
    scene.add.existing(this);
  }

  update() {
    this.x = this._scene.w(0);
    if (this._tweening) return;
    this.setPosition(this._scene.w(0), this._scene.h(0) + this._scene.d(0.41));
    this._illustration.setScale(this._scene.d(4) / 1080);
    this._grade.setPosition(-this._scene.d(32 / 9 - 0.9), -this._scene.d(2.9));
    this._grade.setScale(this._scene.d(1.8) / this._grade.texture.getSourceImage().height);
    this._score.setPosition(this._scene.d(32 / 9), -this._scene.d(3.8));
    this._score.resize();
    const upperBoard = [this._accuracy, this._maxCombo, this._stdDev];
    position(upperBoard, -this._scene.d(32 / 9 - 1.9), this._scene.d(32 / 9));
    upperBoard.forEach((item) => {
      item.y = -this._scene.d(2.67);
      item.resize();
    });
    const lowerBoard = [this._perfect, this._good, this._bad, this._miss, this._early, this._late];
    position(lowerBoard, -this._scene.d(32 / 9), this._scene.d(32 / 9), 5);
    lowerBoard.forEach((item, i) => {
      item.y = this._scene.d(i < 4 ? 2.16 : i < 5 ? 2.14 : 2.39);
      item.resize(i >= 4 ? this._scene.d(64 / 9 / 5) : undefined);
    });
  }

  destroy() {
    if (this._timer) clearInterval(this._timer);
    this._sound?.stop();
    super.destroy();
  }

  createOverlay() {
    const rect = new GameObjects.Rectangle(
      this._scene,
      0,
      0,
      this._scene.p(1800),
      this._scene.d(40),
      0x000000,
      1,
    );
    this.add(rect);
    return rect;
  }

  createInnerContainer() {
    const container = new GameObjects.Container(this._scene, 0, -this._scene.d(16));
    this.add(container);
    return container;
  }

  createIllustration() {
    const container = new GameObjects.Container(this._scene);
    const illustration = new GameObjects.Image(this._scene, 0, 0, 'illustration-cropped');
    illustration.setScale(1080 / illustration.texture.getSourceImage().height);
    const title = this.createText(this._scene.metadata.title ?? '', -912, 513, 0, 1, 72);
    const level = this.createText(this._scene.metadata.level ?? '', 912, 513, 1, 1);
    container.add(illustration);
    container.add(title);
    container.add(level);
    container.setScale(this._scene.d(4) / 1080);
    this._innerContainer.add(container);
    return container;
  }

  createText(
    text: string,
    x: number,
    y: number,
    originX: number,
    originY: number,
    size: number = 64,
  ) {
    return new GameObjects.Text(this._scene, x, y, text, {
      fontFamily: FONT_FAMILY,
      fontSize: size,
      color: '#ffffff',
      align: 'center',
    }).setOrigin(originX, originY);
  }

  createGrade(grade: Grade) {
    const gradeImage = new GameObjects.Image(this._scene, 0, this._scene.d(1), `grade-${grade}`);
    gradeImage.setScale(this._scene.d(4.8) / gradeImage.texture.getSourceImage().height);
    this.add(gradeImage);
    return gradeImage;
  }

  createScore(score: number) {
    const scoreBoard = new ScoreBoard(
      this._scene,
      this._scene.d(32 / 9),
      -this._scene.d(2.1),
      score,
    );
    this._innerContainer.add(scoreBoard);
    return scoreBoard;
  }

  createDataBoard(x: number, y: number, key: string, value: string, singleLineWidth?: number) {
    const dataBoard = new DataBoard(this._scene, x, y, key, value, singleLineWidth);
    this._innerContainer.add(dataBoard);
    return dataBoard;
  }

  play() {
    this.setVisible(true);
    this._innerContainer.setScale(0.75);
    this._overlay.setAlpha(0);
    this._sound = this._scene.sound.add('ending');
    this._sound.setVolume(this._scene.preferences.musicVolume).play();
    this._scene.sound.add('grade-hit').setVolume(this._scene.preferences.hitSoundVolume).play();
    this._timer = setInterval(
      () => {
        this._sound.play();
      },
      192e3 / 7 / this._scene.tweens.timeScale,
    );
    setTimeout(
      () => {
        EventBus.emit('recording-stop');
      },
      (this._loopsToRecord * 192e3) / 7 / this._scene.tweens.timeScale,
    );
    this._tweening = true;
    if (Capacitor.getPlatform() !== 'android')
      this._grade.preFX?.addShine((7 / 6) * this._scene.tweens.timeScale, 1, 3, false);

    // Overlay (to dim the background)
    this._scene.tweens.add({
      targets: this._overlay,
      alpha: 0.7,
      ease: 'Quint.easeOut',
      duration: 9e3 / 14,
    });
    this._scene.tweens.add({
      targets: this._overlay,
      alpha: 0,
      ease: 'Expo.easeIn',
      duration: 9e3 / 14,
      delay: 9e3 / 14,
    });

    // Containers
    this._scene.tweens.add({
      targets: this,
      y: this._scene.h(0) + this._scene.d(0.41),
      ease: 'Cubic.easeOut',
      duration: 9e3 / 7,
    });
    this._scene.tweens.add({
      targets: this._innerContainer,
      y: 0,
      ease: 'Expo.easeOut',
      duration: 9e3 / 7,
    });
    this._scene.tweens.add({
      targets: this._innerContainer,
      scale: 1,
      ease: 'Expo.easeIn',
      duration: 9e3 / 7,
    });

    // Grade
    this._scene.tweens.add({
      targets: this._grade,
      scale: this._scene.d(1.8) / this._grade.texture.getSourceImage().height,
      ease: 'Expo.easeIn',
      duration: 9e3 / 7,
    });
    this._scene.tweens.add({
      targets: this._grade,
      y: -this._scene.d(0.41),
      ease: 'Quint.easeOut',
      duration: 9e3 / 14,
    });
    this._scene.tweens.add({
      targets: this._grade,
      x: -this._scene.d(32 / 9 - 0.9),
      y: -this._scene.d(2.9),
      ease: 'Expo.easeIn',
      duration: 9e3 / 14,
      delay: 9e3 / 14,
    });

    // Stats
    this._scene.tweens.add({
      targets: this._score,
      y: -this._scene.d(3.8),
      ease: 'Expo.easeOut',
      duration: 9e3 / 14,
      delay: 9e3 / 7,
    });
    this._scene.tweens.add({
      targets: [this._accuracy, this._maxCombo, this._stdDev],
      y: -this._scene.d(2.67),
      ease: 'Expo.easeOut',
      duration: 9e3 / 14,
      delay: 9e3 / 7,
    });
    this._scene.tweens.add({
      targets: [this._perfect, this._good, this._bad, this._miss],
      y: this._scene.d(2.16),
      ease: 'Expo.easeOut',
      duration: 9e3 / 14,
      delay: 9e3 / 7,
    });
    this._scene.tweens.add({
      targets: this._early,
      y: this._scene.d(2.14),
      ease: 'Expo.easeOut',
      duration: 9e3 / 14,
      delay: 9e3 / 7,
    });
    this._scene.tweens.add({
      targets: this._late,
      y: this._scene.d(2.39),
      ease: 'Expo.easeOut',
      duration: 9e3 / 14,
      delay: 9e3 / 7,
    });

    // Shake
    this._scene.tweens.add({
      targets: this,
      x: this._scene.w(-28.13),
      y: this._scene.h(28.13) + this._scene.d(0.41),
      rotation: (-28.13 / 2520) * Math.PI,
      ease: 'Sine.easeOut',
      duration: 3e3 / 28,
      delay: 9e3 / 7,
    });
    this._scene.tweens.add({
      targets: this,
      x: this._scene.w(12.5),
      y: this._scene.h(-12.5) + this._scene.d(0.41),
      rotation: (12.5 / 2520) * Math.PI,
      ease: 'Sine.easeInOut',
      duration: 6e3 / 28,
      delay: 39e3 / 28,
    });
    this._scene.tweens.add({
      targets: this,
      x: this._scene.w(-3.13),
      y: this._scene.h(3.13) + this._scene.d(0.41),
      rotation: (-3.13 / 2520) * Math.PI,
      ease: 'Sine.easeInOut',
      duration: 6e3 / 28,
      delay: 45e3 / 28,
    });
    this._scene.tweens.add({
      targets: this,
      x: this._scene.w(0),
      y: this._scene.h(0) + this._scene.d(0.41),
      rotation: 0,
      ease: 'Sine.easeInOut',
      duration: 6e3 / 28,
      delay: 51e3 / 28,
      onComplete: () => {
        this._tweening = false;
      },
    });
  }
}

class DataBoard extends GameObjects.Container {
  private _scene: Game;
  private _key: GameObjects.Text;
  private _value: GameObjects.Text;
  private _singleLineWidth: number | undefined;

  constructor(
    scene: Game,
    x: number,
    y: number,
    key: string,
    value: string,
    singleLineWidth?: number,
  ) {
    super(scene, x, y);

    this._scene = scene;
    this._key = new GameObjects.Text(scene, 0, 0, key, {
      fontFamily: FONT_FAMILY,
      fontSize: scene.d(0.16),
      color: '#ffffff',
    })
      .setAlpha(0.5)
      .setOrigin(0, 0);
    this._value = new GameObjects.Text(
      scene,
      singleLineWidth ?? 0,
      singleLineWidth ? 0 : this._key.displayHeight,
      value,
      {
        fontFamily: FONT_FAMILY,
        fontSize: scene.d(singleLineWidth ? 0.26 : 0.32),
        color: '#ffffff',
      },
    ).setOrigin(singleLineWidth ? 1 : 0, 0);
    this._singleLineWidth = singleLineWidth;
    if (singleLineWidth) {
      this._key.setOrigin(0, 0.5);
      this._key.y = this._value.displayHeight / 2;
    }
    this.add(this._key);
    this.add(this._value);
  }

  resize(singleLineWidth?: number) {
    this._key.setFontSize(this._scene.d(0.16));
    this._value
      .setPosition(singleLineWidth ?? 0, singleLineWidth ? 0 : this._key.displayHeight)
      .setFontSize(this._scene.d(singleLineWidth ? 0.26 : 0.32));
    this._singleLineWidth = singleLineWidth;
  }

  public get actualWidth() {
    return this._singleLineWidth ?? Math.max(this._key.displayWidth, this._value.displayWidth);
  }
}

class ScoreBoard extends GameObjects.Container {
  private _scene: Game;
  private _score: GameObjects.Text;

  constructor(scene: Game, x: number, y: number, score: number) {
    super(scene, x, y);

    this._scene = scene;
    this._score = new GameObjects.Text(scene, 0, 0, pad(score, 7), {
      fontFamily: FONT_FAMILY,
      fontSize: this._scene.d(1.05),
      color: '#ffffff',
    }).setOrigin(1, 0);

    this.add(this._score);
  }

  resize() {
    this._score.setFontSize(this._scene.d(1.05));
  }

  public get score() {
    return this._score;
  }
}
