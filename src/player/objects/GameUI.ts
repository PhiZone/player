import { GameObjects, Tweens, type Types } from 'phaser';
import type { Game } from '../scenes/Game';
import { pad } from '../utils';
import { GameStatus } from '../types';
import { COMBO_TEXT, FONT_FAMILY } from '../constants';

export class GameUI {
  private _scene: Game;
  private _pause: Button;
  private _combo: UIComponent;
  private _comboText: UIComponent;
  private _score: UIComponent;
  private _accuracy: UIComponent;
  private _songTitle: UIComponent;
  private _level: UIComponent;
  private _progressBar: GameObjects.Image;
  private _positions: number[][] = [
    [-650, 435],
    [0, 435],
    [0, 435],
    [650, 435],
    [650, 435],
    [-650, -435],
    [650, -435],
  ];
  private _offsets: number[][] = [
    [0, 5],
    [0, 0],
    [0, 60],
    [0, 0],
    [0, 50],
    [0, 0],
    [0, 0],
  ];
  private _fontSizes: number[] = [0, 60, 20, 50, 25, 32, 32];

  constructor(scene: Game) {
    this._scene = scene;
    const stats = scene.statistics.stats;

    this._pause = this.createButton(
      scene.w(this._positions[0][0]),
      scene.h(this._positions[0][1]),
      this._scene.p(this._offsets[0][0]),
      this._scene.p(this._offsets[0][1]),
      0,
      0,
      'pause',
    );
    this._pause.image.on('pointerup', () => {
      if (scene.status !== GameStatus.PLAYING || !scene.song.isPlaying) return;
      const background = this._pause.background;
      if (background.alpha > 0.3) {
        scene.pause();
        return;
      }
      const tween = this._pause.tween;
      if (tween) scene.tweens.remove(tween);
      background.setAlpha(0.4);
      this._pause.setTween(
        scene.tweens.add({
          targets: background,
          alpha: 0,
          ease: 'Cubic.easeIn',
          duration: 500,
        }),
      );
    });

    this._combo = this.createComponent(
      scene.w(this._positions[1][0]),
      scene.h(this._positions[1][1]),
      this._scene.p(this._offsets[1][0]),
      this._scene.p(this._offsets[1][1]),
      0.5,
      0,
      stats.combo.toString(),
      scene.p(this._fontSizes[1]),
    );

    this._comboText = this.createComponent(
      scene.w(this._positions[2][0]),
      scene.h(this._positions[2][1]),
      this._scene.p(this._offsets[2][0]),
      this._scene.p(this._offsets[2][1]),
      0.5,
      0,
      'COMBO',
      scene.p(this._fontSizes[2]),
    );

    this._score = this.createComponent(
      scene.w(this._positions[3][0]),
      scene.h(this._positions[3][1]),
      this._scene.p(this._offsets[3][0]),
      this._scene.p(this._offsets[3][1]),
      1,
      0,
      pad(stats.displayScore, 7),
      scene.p(this._fontSizes[3]),
    );

    this._accuracy = this.createComponent(
      scene.w(this._positions[4][0]),
      scene.h(this._positions[4][1]),
      this._scene.p(this._offsets[4][0]),
      this._scene.p(this._offsets[4][1]),
      1,
      0,
      `${stats.displayStdDev.toFixed(3)} ms · ${stats.accuracy.toLocaleString(undefined, {
        style: 'percent',
        minimumFractionDigits: 2,
      })}`,
      scene.p(this._fontSizes[4]),
    ).setAlpha(0.7);

    this._songTitle = this.createComponent(
      scene.w(this._positions[5][0]),
      scene.h(this._positions[5][1]),
      this._scene.p(this._offsets[5][0]),
      this._scene.p(this._offsets[5][1]),
      0,
      1,
      scene.metadata.title ?? '',
      scene.p(this._fontSizes[5]),
    );

    this._level = this.createComponent(
      scene.w(this._positions[6][0]),
      scene.h(this._positions[6][1]),
      this._scene.p(this._offsets[6][0]),
      this._scene.p(this._offsets[6][1]),
      1,
      1,
      scene.metadata.level ?? '',
      scene.p(this._fontSizes[6]),
    );

    this._progressBar = scene.add.image(0, 0, 'progress-bar').setOrigin(1, 0).setDepth(8);
    this.setVisible(false);
  }

  update() {
    const metadata = this._scene.metadata;
    const stats = this._scene.statistics.stats;

    this._combo.setText(stats.combo.toString());
    this._comboText.setText(COMBO_TEXT);
    this._score.setText(pad(stats.displayScore, 7));
    this._accuracy.setText(
      `${stats.displayStdDev.toFixed(3)} ms · ${stats.accuracy.toLocaleString(undefined, {
        style: 'percent',
        minimumFractionDigits: 2,
      })}`,
    );
    this._songTitle.setText(metadata.title ?? '');
    this._level.setText(metadata.level ?? '');

    [
      this._pause,
      this._combo,
      this._comboText,
      this._score,
      this._accuracy,
      this._songTitle,
      this._level,
    ].forEach((obj, i) => {
      obj.container.setPosition(
        this._scene.w(this._positions[i][0]),
        this._scene.h(this._positions[i][1]),
      );
      if ('resize' in obj) {
        obj.resize(this._scene.p(0.5));
      } else {
        obj.text.setFontSize(this._scene.p(this._fontSizes[i]));
        obj.text.setPosition(
          this._scene.p(this._offsets[i][0]),
          this._scene.p(this._offsets[i][1]),
        );
      }
    });

    const song = this._scene.song;
    this._progressBar.setScale(
      this._scene.p(1350) / this._progressBar.texture.getSourceImage().width,
    );
    this._progressBar.setX(
      this._scene.p(
        (this._scene.status === GameStatus.FINISHED ? 1 : song.seek / song.duration) * 1350,
      ),
    );
  }

  destroy() {
    this._pause.destroy();
    this._combo.destroy();
    this._comboText.destroy();
    this._score.destroy();
    this._accuracy.destroy();
    this._songTitle.destroy();
    this._level.destroy();
    this._progressBar.destroy();
  }

  in() {
    this._scene.tweens.add({
      targets: [
        this._pause,
        this._combo,
        this._comboText,
        this._score,
        this._accuracy,
        this._songTitle,
        this._level,
      ],
      y: 0,
      ease: 'Cubic.easeOut',
      duration: 1000,
    });
  }

  out() {
    [
      this._scene.tweens.add({
        targets: [
          this._pause,
          this._combo,
          this._comboText,
          this._score,
          this._accuracy,
          this._progressBar,
        ],
        y: this._scene.p(-100),
        ease: 'Cubic.easeIn',
        duration: 1000,
      }),
      this._scene.tweens.add({
        targets: [this._songTitle, this._level],
        y: this._scene.p(100),
        ease: 'Cubic.easeIn',
        duration: 1000,
      }),
    ].forEach((tween) => {
      tween.on('complete', () => {
        tween.targets.forEach((o) => {
          const target = o as Button | UIComponent | GameObjects.Image;
          target.setVisible(false);
        });
      });
    });
  }

  createComponent(
    x: number,
    y: number,
    offsetX: number,
    offsetY: number,
    originX: number,
    originY: number,
    text: string,
    fontSize?: number | undefined,
    textStyle?: Types.GameObjects.Text.TextStyle | undefined,
  ) {
    const container = this._scene.add.container(x, y).setDepth(8);
    const component = new UIComponent(
      this._scene,
      container,
      0,
      this._scene.p(100) * (2 * originY - 1),
      offsetX,
      offsetY,
      originX,
      originY,
      text,
      fontSize,
      textStyle,
    );
    return component;
  }

  createButton(
    x: number,
    y: number,
    offsetX: number,
    offsetY: number,
    originX: number,
    originY: number,
    texture: string,
  ) {
    const container = this._scene.add.container(x, y).setDepth(8);
    const button = new Button(
      this._scene,
      container,
      0,
      this._scene.p(100) * (2 * originY - 1),
      offsetX,
      offsetY,
      originX,
      originY,
      texture,
    );
    return button;
  }

  setVisible(visible: boolean) {
    [
      this._pause,
      this._combo,
      this._comboText,
      this._score,
      this._accuracy,
      this._songTitle,
      this._level,
    ].forEach((obj) => {
      obj.setVisible(visible);
    });
  }

  public get pause() {
    return this._pause;
  }
}

class UIComponent extends GameObjects.Container {
  private _text: GameObjects.Text;
  private _background: GameObjects.Graphics;
  private _container: GameObjects.Container;
  constructor(
    scene: Game,
    container: GameObjects.Container,
    x: number,
    y: number,
    offsetX: number,
    offsetY: number,
    originX: number,
    originY: number,
    text: string,
    fontSize?: number | undefined,
    textStyle?: Types.GameObjects.Text.TextStyle | undefined,
  ) {
    super(scene, x, y);

    scene.add.existing(this);
    this._container = container;
    this._container.add(this);
    this._text = new GameObjects.Text(
      scene,
      offsetX,
      offsetY,
      text,
      textStyle ?? {
        fontFamily: FONT_FAMILY,
        fontSize: fontSize ?? 32,
        color: '#ffffff',
        align: 'center',
      },
    ).setOrigin(originX, originY);

    this._background = new GameObjects.Graphics(scene);

    this.add(this._text);
    this.add(this._background);
  }

  setText(text: string) {
    this._text.setText(text);
  }

  public get text() {
    return this._text;
  }

  public get background() {
    return this._background;
  }

  public get container() {
    return this._container;
  }
}

class Button extends GameObjects.Container {
  private _image: GameObjects.Image;
  private _background: GameObjects.Arc;
  private _tween: Tweens.Tween | undefined;
  private _container: GameObjects.Container;
  constructor(
    scene: Game,
    container: GameObjects.Container,
    x: number,
    y: number,
    offsetX: number,
    offsetY: number,
    originX: number,
    originY: number,
    texture: string,
  ) {
    super(scene, x, y);

    this._container = container;
    this._container.add(this);
    this._image = new GameObjects.Image(scene, offsetX, offsetY, texture)
      .setOrigin(originX, originY)
      .setDepth(1);

    this._background = new GameObjects.Arc(
      scene,
      this._image.x + this._image.displayWidth / 2,
      this._image.y + this._image.displayHeight / 2,
      Math.max(this._image.displayWidth, this._image.displayHeight) * Math.SQRT1_2,
      undefined,
      undefined,
      undefined,
      0xffffff,
      1,
    ).setAlpha(0);

    this._image.setInteractive(this._background, (area, x, y, _obj) =>
      this.isInovokeable(x, y, area),
    );
    this.add(this._image);
    this.add(this._background);
  }

  resize(scale: number) {
    this._image.setScale(scale);
    this._background.setRadius(
      Math.max(this._image.displayWidth, this._image.displayHeight) * Math.SQRT1_2,
    );
    this._background.setPosition(
      this._image.x + this._image.displayWidth / 2,
      this._image.y + this._image.displayHeight / 2,
    );
  }

  public get image() {
    return this._image;
  }

  public get background() {
    return this._background;
  }

  public get tween() {
    return this._tween;
  }

  setTween(tween: Tweens.Tween) {
    this._tween = tween;
  }

  isInovokeable(x: number, y: number, area: GameObjects.Arc = this._background) {
    const refX = area.x + area.width / 2;
    const refY = area.y + area.height / 2;
    const radius = area.radius * 3;
    return radius ** 2 > (x - refX) ** 2 + (y - refY) ** 2;
  }

  public get container() {
    return this._container;
  }
}
