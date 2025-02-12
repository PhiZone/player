import { GameObjects, Tweens, type Types } from 'phaser';
import type { Game } from '../scenes/Game';
import { pad } from '../utils';
import { GameStatus } from '$lib/types';
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
  private _progressBar: ProgressBar;
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
  private _upperTargets: (Button | UIComponent | ProgressBar)[];
  private _lowerTargets: (Button | UIComponent | ProgressBar)[];
  private _visible: boolean = false;

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
      8,
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
      'combo',
      scene.w(this._positions[1][0]),
      scene.h(this._positions[1][1]),
      this._scene.p(this._offsets[1][0]),
      this._scene.p(this._offsets[1][1]),
      0.5,
      0,
      9,
      stats.combo.toString(),
      scene.p(this._fontSizes[1]),
      'Outfit',
    );

    this._comboText = this.createComponent(
      'combotext',
      scene.w(this._positions[2][0]),
      scene.h(this._positions[2][1]),
      this._scene.p(this._offsets[2][0]),
      this._scene.p(this._offsets[2][1]),
      0.5,
      0,
      10,
      COMBO_TEXT,
      scene.p(this._fontSizes[2]),
    );

    this._score = this.createComponent(
      'score',
      scene.w(this._positions[3][0]),
      scene.h(this._positions[3][1]),
      this._scene.p(this._offsets[3][0]),
      this._scene.p(this._offsets[3][1]),
      1,
      0,
      11,
      pad(stats.displayScore, 7),
      scene.p(this._fontSizes[3]),
      'Outfit',
    );

    this._accuracy = this.createComponent(
      'accuracy',
      scene.w(this._positions[4][0]),
      scene.h(this._positions[4][1]),
      this._scene.p(this._offsets[4][0]),
      this._scene.p(this._offsets[4][1]),
      1,
      0,
      12,
      `${stats.displayStdDev.toFixed(3)} ms · ${stats.accuracy.toLocaleString(undefined, {
        style: 'percent',
        minimumFractionDigits: 2,
      })}`,
      scene.p(this._fontSizes[4]),
      'Outfit',
    );
    this._accuracy.text.setAlpha(0.7);

    this._songTitle = this.createComponent(
      'title',
      scene.w(this._positions[5][0]),
      scene.h(this._positions[5][1]),
      this._scene.p(this._offsets[5][0]),
      this._scene.p(this._offsets[5][1]),
      0,
      1,
      14,
      scene.metadata.title ?? '',
      scene.p(this._fontSizes[5]),
    );

    this._level = this.createComponent(
      'level',
      scene.w(this._positions[6][0]),
      scene.h(this._positions[6][1]),
      this._scene.p(this._offsets[6][0]),
      this._scene.p(this._offsets[6][1]),
      1,
      1,
      15,
      scene.metadata.level ?? '',
      scene.p(this._fontSizes[6]),
    );

    this._progressBar = new ProgressBar(this, 13);
    this._upperTargets = [
      this._pause,
      this._combo,
      this._comboText,
      this._score,
      this._accuracy,
      this._progressBar,
    ];
    this._lowerTargets = [this._songTitle, this._level];
    this.setVisible(false);
  }

  update() {
    this._combo.setVisible(this._visible && this._scene.statistics.combo >= 3);
    this._comboText.setVisible(this._visible && this._scene.statistics.combo >= 3);
    this._combo.setText(this._scene.statistics.combo.toString());
    this._score.setText(pad(Math.round(this._scene.statistics.displayScore), 7));
    this._accuracy.setText(
      `${this._scene.statistics.displayStdDev.toFixed(3)} ms · ${this._scene.statistics.accuracy.toLocaleString(
        undefined,
        {
          style: 'percent',
          minimumFractionDigits: 2,
        },
      )}`,
    );
    this._songTitle.setText(this._scene.metadata.title ?? '');
    this._level.setText(this._scene.metadata.level ?? '');

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
    this._progressBar.bar.setScale(
      this._scene.p(1350) / this._progressBar.bar.texture.getSourceImage().width,
    );
    this._progressBar.bar.setX(
      this._scene.p(
        (this._scene.status === GameStatus.FINISHED ? 1 : song.seek / song.duration) * 1350,
      ),
    );
  }

  destroy() {
    [...this._upperTargets, ...this._lowerTargets].forEach((o) => {
      o.destroy();
    });
  }

  in() {
    if (
      ![...this._upperTargets, ...this._lowerTargets].every(
        (o) => o.y === 0 && o.rotation % (2 * Math.PI) === 0,
      )
    ) {
      return;
    }
    this._upperTargets.forEach((o) => {
      o.y = this._scene.p(-100);
    });
    this._lowerTargets.forEach((o) => {
      o.y = this._scene.p(100);
    });
    this._scene.tweens.add({
      targets: [...this._upperTargets, ...this._lowerTargets],
      y: 0,
      ease: 'Cubic.easeOut',
      duration: 1000,
      onStart: (tween) => {
        this.setVisible(true);
        tween.targets.forEach((o) => {
          const target = o as Button | ProgressBar | UIComponent;
          target.isAnimationPlaying = true;
        });
      },
      onComplete: (tween) => {
        tween.targets.forEach((o) => {
          const target = o as Button | ProgressBar | UIComponent;
          target.isAnimationPlaying = false;
        });
      },
    });
  }

  out() {
    if (
      ![...this._upperTargets, ...this._lowerTargets].every(
        (o) => o.y === 0 && o.rotation % (2 * Math.PI) === 0,
      )
    ) {
      this.setVisible(false);
      return;
    }
    [
      this._scene.tweens.add({
        targets: this._upperTargets,
        y: this._scene.p(-100),
        ease: 'Cubic.easeIn',
        duration: 1000,
        onComplete: () => {
          this.setVisible(false);
        },
      }),
      this._scene.tweens.add({
        targets: this._lowerTargets,
        y: this._scene.p(100),
        ease: 'Cubic.easeIn',
        duration: 1000,
      }),
    ].forEach((tween) => {
      tween.on('start', () => {
        tween.targets.forEach((o) => {
          const target = o as Button | ProgressBar | UIComponent;
          target.isAnimationPlaying = true;
        });
      });
      tween.on('complete', () => {
        tween.targets.forEach((o) => {
          const target = o as Button | ProgressBar | UIComponent;
          target.isAnimationPlaying = false;
          target.y = 0;
        });
      });
    });
  }

  createComponent(
    name: string,
    x: number,
    y: number,
    offsetX: number,
    offsetY: number,
    originX: number,
    originY: number,
    depth: number,
    text: string,
    fontSize?: number | undefined,
    bitmapFont?: string | undefined,
    textStyle?: Types.GameObjects.Text.TextStyle | undefined,
  ) {
    const container = new GameObjects.Container(this._scene, x, y).setDepth(depth);
    this._scene.registerNode(container, `ui-${name}`);
    const component = new UIComponent(
      this._scene,
      container,
      0,
      0,
      offsetX,
      offsetY,
      originX,
      originY,
      text,
      bitmapFont,
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
    depth: number,
    texture: string,
  ) {
    const container = new GameObjects.Container(this._scene, x, y).setDepth(depth);
    this._scene.registerNode(container, 'ui-button');
    const button = new Button(
      this._scene,
      container,
      0,
      0,
      offsetX,
      offsetY,
      originX,
      originY,
      texture,
    );
    return button;
  }

  setVisible(visible: boolean) {
    this._visible = visible;
    [...this._upperTargets, ...this._lowerTargets].forEach((obj) => {
      obj.setVisible(visible);
    });
  }

  public get pause() {
    return this._pause;
  }

  public get combo() {
    return this._combo;
  }

  public get comboText() {
    return this._comboText;
  }

  public get score() {
    return this._score;
  }

  public get accuracy() {
    return this._accuracy;
  }

  public get songTitle() {
    return this._songTitle;
  }

  public get level() {
    return this._level;
  }

  public get progressBar() {
    return this._progressBar;
  }

  public get upperTargets() {
    return this._upperTargets;
  }

  public get lowerTargets() {
    return this._lowerTargets;
  }

  public get scene() {
    return this._scene;
  }
}

class UIComponent extends GameObjects.Container {
  private _text: GameObjects.Text | GameObjects.BitmapText;
  private _background: GameObjects.Graphics;
  private _container: GameObjects.Container;
  private _isAnimationPlaying: boolean = false;

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
    bitmapFont?: string | undefined,
    fontSize?: number | undefined,
    textStyle?: Types.GameObjects.Text.TextStyle | undefined,
  ) {
    super(scene, x, y);

    this._container = container;
    this._container.add(this);
    this._text = bitmapFont
      ? new GameObjects.BitmapText(
          scene,
          offsetX,
          offsetY,
          bitmapFont,
          text,
          fontSize ?? 32,
        ).setOrigin(originX, originY)
      : new GameObjects.Text(
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

  updateAttach(
    params: {
      x: number;
      y: number;
      rotation: number;
      alpha: number;
      scaleX: number;
      scaleY: number;
      tint: number;
    },
    fromCenter = false,
  ) {
    if (this._isAnimationPlaying) return;
    const { x, y, rotation, alpha, scaleX, scaleY, tint } = params;
    if (fromCenter) {
      const deltaX =
        2 *
        (this._text.y +
          -this._text.displayHeight * this._text.originY +
          this._text.displayHeight / 2) *
        Math.sin(rotation / 2) *
        Math.sin((Math.PI - rotation) / 2);
      this.setPosition(
        x +
          deltaX +
          (this._text.x +
            -this._text.displayWidth * this._text.originX +
            this._text.displayWidth / 2) *
            (scaleX - 1),
        y +
          deltaX / Math.tan((Math.PI - rotation) / 2) -
          (this._text.y +
            -this._text.displayHeight * this._text.originY +
            this._text.displayHeight / 2) *
            (scaleY - 1),
      );
    } else {
      this.setPosition(x, y);
    }
    this.setRotation(rotation);
    this.setAlpha(alpha);
    this.setScale(scaleX, scaleY);
    this._text.setTint(tint);
  }

  public set isAnimationPlaying(value: boolean) {
    this._isAnimationPlaying = value;
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

class ProgressBar extends GameObjects.Container {
  private _progressBar: GameObjects.Image;
  private _isAnimationPlaying: boolean = false;

  constructor(ui: GameUI, depth: number) {
    super(ui.scene);
    this._progressBar = new GameObjects.Image(ui.scene, 0, 0, 'progress-bar').setOrigin(1, 0.2);
    this.setDepth(depth);
    this.add(this._progressBar);
    ui.scene.registerNode(this, 'ui-bar');
  }

  setAttach(params: {
    x: number;
    y: number;
    rotation: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
    tint: number;
  }) {
    if (this._isAnimationPlaying) return;
    const { x, y, rotation, alpha, scaleX, scaleY, tint } = params;
    this.setPosition(x, y);
    this.setRotation(rotation);
    this.setAlpha(alpha);
    this.setScale(scaleX, scaleY);
    this._progressBar.setTint(tint);
  }

  public set isAnimationPlaying(value: boolean) {
    this._isAnimationPlaying = value;
  }

  public get bar() {
    return this._progressBar;
  }
}

class Button extends GameObjects.Container {
  private _image: GameObjects.Image;
  private _background: GameObjects.Arc;
  private _tween: Tweens.Tween | undefined;
  private _container: GameObjects.Container;
  private _isAnimationPlaying: boolean = false;

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
      this.isInvokeable(x, y, area),
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

  setAttach(params: {
    x: number;
    y: number;
    rotation: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
    tint: number;
  }) {
    if (this._isAnimationPlaying) return;
    const { x, y, rotation, alpha, scaleX, scaleY, tint } = params;
    this.setPosition(x, y);
    this.setRotation(rotation);
    this.setAlpha(alpha);
    this.setScale(scaleX, scaleY);
    this._image.setTint(tint);
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

  isInvokeable(x: number, y: number, area: GameObjects.Arc = this._background) {
    const refX = area.x + area.width / 2;
    const refY = area.y + area.height / 2;
    const radius = area.radius * 3;
    return radius ** 2 > (x - refX) ** 2 + (y - refY) ** 2;
  }

  public set isAnimationPlaying(value: boolean) {
    this._isAnimationPlaying = value;
  }

  public get container() {
    return this._container;
  }
}
