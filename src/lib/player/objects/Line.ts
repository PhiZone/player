import { GameObjects } from 'phaser';
import {
  type ColorEvent,
  type Event,
  type GifEvent,
  type JudgeLine,
  type SpeedEvent,
  type TextEvent,
} from '$lib/types';
import { LongNote } from './LongNote';
import { PlainNote } from './PlainNote';
import {
  getIntegral,
  getLineColor,
  getTimeSec,
  getEventValue,
  processEvents,
  rgbToHex,
  toBeats,
  processControlNodes,
  isEqual,
} from '../utils';
import type { Game } from '../scenes/Game';
import { FONT_FAMILY, NOTE_BASE_SIZE } from '../constants';
import { dot } from 'mathjs';
import type { Video } from './Video';
import { isDebug } from '$lib/utils';

export class Line {
  private _scene: Game;
  private _index: number;
  private _data: JudgeLine;
  private _line: GameObjects.Image | GameObjects.Sprite | GameObjects.Text;
  private _parent: Line | null = null;
  private _noteContainers: Record<number, GameObjects.Container> = {};
  private _noteMask: GameObjects.Graphics | null = null;
  private _notes: (PlainNote | LongNote)[] = [];
  private _hasAttach: boolean = false;
  private _hasCustomTexture: boolean = false;
  private _hasAnimatedTexture: boolean = false;
  private _hasText: boolean = false;
  private _xModifier: 1 | -1 = 1;
  private _yModifier: 1 | -1 = 1;
  private _rotationModifier: 1 | -1 = 1;
  private _rotationOffset: 0 | 180 = 0;

  private _curX = [];
  private _curY = [];
  private _curRot = [];
  private _curAlpha = [];
  private _curSpeed = [];
  private _lastHeight = 0;

  private _curColor = [];
  private _curGif = [];
  private _curIncline = [];
  private _curScaleX = [];
  private _curScaleY = [];
  private _curText = [];

  private _opacity: number = 0;
  private _x: number = 0;
  private _y: number = 0;
  private _rotation: number = 0;
  private _color: number[] | undefined = undefined;
  private _gif: number | undefined = undefined;
  private _incline: number | undefined = undefined;
  private _scaleX: number | undefined = undefined;
  private _scaleY: number | undefined = undefined;
  private _text: string | undefined = undefined;
  private _height: number = 0;
  private _lastUpdate: number = -Infinity;

  private _attachedVideos: Video[] = [];

  private _judgeWindow: (PlainNote | LongNote)[] = [];

  private _debug: GameObjects.Container | undefined = undefined;
  private _selfDebug: GameObjects.Container | undefined = undefined;

  constructor(
    scene: Game,
    lineData: JudgeLine,
    num: number,
    precedence: number,
    highlightMoments: [number, number, number][],
  ) {
    this._scene = scene;
    this._index = num;
    this._data = lineData;
    this._hasText = (this._data.extended?.textEvents?.length ?? 0) > 0;
    this._hasCustomTexture = this._hasText || lineData.Texture !== 'line.png';
    this._hasAnimatedTexture =
      ['.gif', '.apng'].some((e) => lineData.Texture.toLowerCase().endsWith(e)) &&
      this._scene.textures.exists(`asset-${lineData.Texture}`);
    this._line = this._hasText
      ? new GameObjects.Text(scene, 0, 0, this._text ?? '', {
          fontFamily: FONT_FAMILY,
          fontSize: 50,
          color: '#ffffff',
          align: 'left',
        }).setOrigin(0.5)
      : this._hasAnimatedTexture
        ? new GameObjects.Sprite(scene, 0, 0, `asset-${lineData.Texture}`).play(
            `asset-${lineData.Texture}`,
          )
        : new GameObjects.Image(scene, 0, 0, this.getLineTexture(`asset-${lineData.Texture}`));

    this._hasAttach = !!this._data.attachUI;
    this._line.setScale(
      this._scene.p(1) * (this._scaleX ?? 1),
      (this._hasCustomTexture
        ? this._scene.p(1)
        : this._scene.o(1.35) * this._scene.preferences.lineThickness) * (this._scaleY ?? 1),
    ); // previously 1.0125 (according to the official definition that a line is 3 times as wide as the screen)
    this._line.setDepth(lineData.zIndex !== undefined ? lineData.zIndex : 2 + precedence);
    this._line.setVisible(!this._hasAttach || !!lineData.appearanceOnAttach || this._hasText);
    if (!this._hasCustomTexture && (!this._hasAttach || lineData.appearanceOnAttach === 2))
      this._line.setTint(getLineColor(scene));
    if (this._data.anchor) this._line.setOrigin(this._data.anchor[0], 1 - this._data.anchor[1]);

    if (scene.preferences.chartFlipping & 1) {
      this._xModifier = -1;
      this._rotationModifier = -1;
    }
    if (scene.preferences.chartFlipping & 2) {
      this._yModifier = -1;
      this._rotationModifier = (-1 * this._xModifier) as 1 | -1;
      this._rotationOffset = 180;
    }

    this.setVisible(false);
    scene.registerNode(this._line, `line-${num}`);

    this._data.eventLayers.forEach((layer) => {
      processEvents(layer?.alphaEvents);
      processEvents(layer?.moveXEvents);
      processEvents(layer?.moveYEvents);
      processEvents(layer?.rotateEvents);
      processEvents(layer?.speedEvents);
    });

    if (this._data.extended) {
      processEvents(this._data.extended.colorEvents);
      processEvents(this._data.extended.gifEvents);
      processEvents(this._data.extended.inclineEvents);
      processEvents(this._data.extended.scaleXEvents);
      processEvents(this._data.extended.scaleYEvents);
      processEvents(this._data.extended.textEvents);
    }

    processControlNodes(this._data.alphaControl);
    processControlNodes(this._data.posControl);
    processControlNodes(this._data.sizeControl);
    processControlNodes(this._data.skewControl);
    processControlNodes(this._data.yControl);

    if (isDebug()) {
      this._debug = this.createContainer(Infinity);
      this._selfDebug = new GameObjects.Container(scene)
        .add(scene.add.rectangle(0, 0, 40, 40, 0x00ff00).setOrigin(0.5))
        .add(
          scene.add
            .text(0, 60, num.toString(), {
              fontFamily: 'Outfit',
              fontSize: 80,
              color: '#e2e2e2',
              align: 'center',
            })
            .setOrigin(0.5),
        );
      this._debug.add(this._selfDebug);
    }

    if (this._data.notes) {
      this._data.notes.forEach((note) => {
        note.startBeat = toBeats(note.startTime);
        note.endBeat = toBeats(note.endTime);
      });
      this._data.notes.sort((a, b) => a.startBeat - b.startBeat);
      this._data.notes.forEach((data, i) => {
        let note: PlainNote | LongNote;
        const highlight = highlightMoments.some((moment) => isEqual(moment, data.startTime));
        if (data.type === 2) {
          note = new LongNote(scene, data, i, highlight);
          note.setHeadHeight(this.calculateHeight(data.startBeat));
          note.setTailHeight(this.calculateHeight(data.endBeat));
        } else {
          note = new PlainNote(scene, data, i, highlight);
          note.setHeight(this.calculateHeight(data.startBeat));
        }
        this.addNote(note, this._noteContainers[note.zIndex] ?? this.createContainer(note.zIndex));
      });

      if (lineData.scaleOnNotes === 2) {
        this._noteMask = new GameObjects.Graphics(scene);
        const mask = this._noteMask.createGeometryMask();
        Object.values(this._noteContainers).forEach((container) => {
          container.setMask(mask);
        });
      }
    }
  }

  update(beat: number, songTime: number, gameTime: number) {
    if (gameTime == this._lastUpdate) return;
    this._lastUpdate = gameTime;
    this._parent?.update(beat, songTime, gameTime);
    this.handleEventLayers(beat);
    this.updateParams();
    this._notes.forEach((note) => {
      note.update(beat / this._data.bpmfactor, songTime, this._height, this._opacity);
    });
  }

  destroy() {
    this._line.destroy();
    Object.values(this._noteContainers).forEach((container) => {
      container.destroy();
    });
    this._notes.forEach((note) => {
      note.destroy();
    });
  }

  updateParams() {
    this._line.setScale(
      this._scene.p(1) * (this._scaleX ?? 1),
      (this._hasCustomTexture
        ? this._scene.p(1)
        : this._scene.o(1.35) * this._scene.preferences.lineThickness) * (this._scaleY ?? 1),
    );
    if (this._hasText) (this._line as GameObjects.Text).setText(this._text ?? '');
    if (this._hasAnimatedTexture) {
      const sprite = this._line as GameObjects.Sprite;
      if (this._gif !== undefined && this._gif >= 0 && this._gif <= 1) {
        sprite.anims.pause();
        sprite.anims.setProgress(this._gif);
      } else if (sprite.anims?.isPaused) {
        sprite.anims.resume();
      }
    }
    if (this._color !== undefined) this._line.setTint(rgbToHex(this._color));
    else if (!this._hasCustomTexture && (!this._hasAttach || this._data.appearanceOnAttach === 2))
      this._line.setTint(getLineColor(this._scene));
    const { x, y } = this.getPosition();
    const rotation =
      (this._rotationModifier * this._rotation + this._rotationOffset) * (Math.PI / 180);
    this._line.setPosition(x, y);
    this._line.setRotation(rotation);
    this._line.setAlpha(this._opacity / 255);
    Object.values(this._noteContainers).forEach((obj) => {
      obj.setPosition(x, y);
      obj.setRotation(rotation);
      if (this._data.scaleOnNotes === 1) {
        obj.setScale(this._scaleX ?? 1, 1);
      }
    });
    this.updateMask();
    this.updateAttachments();

    if (this._selfDebug) {
      this._selfDebug.setVisible(
        this._notes.findIndex(
          (note) =>
            Math.abs(note.x) < this._scene.p(20) && Math.abs(note.floor) < this._scene.o(20),
        ) === -1,
      );
      this._selfDebug.setScale(this._scene.p(1.4 * NOTE_BASE_SIZE));
    }
  }

  updateAttachments() {
    const params = {
      x: this._line.x - this._scene.sys.canvas.width / 2,
      y: this._line.y - this._scene.sys.canvas.height / 2,
      rotation: this._line.rotation,
      alpha: this._line.alpha,
      scaleX: this._scaleX ?? 1,
      scaleY: this._scaleY ?? 1,
      tint: this._line.tint,
    };
    this.updateUIAttachments(params);
    this.updateAttachedVideos(params);
  }

  updateUIAttachments(params: {
    x: number;
    y: number;
    rotation: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
    tint: number;
  }) {
    if (this._data.attachUI) {
      switch (this._data.attachUI) {
        case 'pause': {
          this._scene.gameUI.pause.setAttach(params);
          return;
        }
        case 'combonumber': {
          this._scene.gameUI.combo.updateAttach(params, true);
          return;
        }
        case 'combo': {
          this._scene.gameUI.comboText.updateAttach(params, true);
          return;
        }
        case 'score': {
          this._scene.gameUI.score.updateAttach(params);
          this._scene.gameUI.accuracy.updateAttach(params);
          return;
        }
        case 'bar': {
          this._scene.gameUI.progressBar.setAttach(params);
          return;
        }
        case 'name': {
          this._scene.gameUI.songTitle.updateAttach(params);
          return;
        }
        case 'level': {
          this._scene.gameUI.level.updateAttach(params);
          return;
        }
      }
    }
  }

  updateAttachedVideos(params: {
    x: number;
    y: number;
    rotation: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
    tint: number;
  }) {
    this._attachedVideos.forEach((video) => {
      video.updateAttach({ ...params, width: this._line.displayWidth });
    });
  }

  getPosition() {
    const halfScreenWidth = this._scene.sys.canvas.width / 2;
    const halfScreenHeight = this._scene.sys.canvas.height / 2;
    let x = this._scene.p(this._xModifier * this._x);
    let y = this._scene.o(-this._yModifier * this._y);
    if (this._parent !== null) {
      const parentX = this._parent.x - halfScreenWidth;
      const parentY = this._parent.y - halfScreenHeight;
      const newX =
        parentX + x * Math.cos(this._parent.rotation) - y * Math.sin(this._parent.rotation);
      const newY =
        parentY + y * Math.cos(this._parent.rotation) + x * Math.sin(this._parent.rotation);
      x = newX;
      y = newY;
    }
    x += halfScreenWidth;
    y += halfScreenHeight;
    return { x, y };
  }

  createContainer(depth: number) {
    const container = new GameObjects.Container(this._scene);
    container.setDepth(depth);
    this._noteContainers[depth] = container;
    this._scene.registerNode(container, `line-${this._index}-cont-${depth}`);
    return container;
  }

  handleEventLayers(beat: number) {
    ({
      alpha: this._opacity,
      x: this._x,
      y: this._y,
      rotation: this._rotation,
      height: this._height,
    } = this._data.eventLayers.reduce(
      (acc, _, i) => {
        const { alpha, x, y, rotation, height } = this.handleEventLayer(
          beat / this._data.bpmfactor,
          i,
        );
        return {
          alpha: acc.alpha + (alpha ?? 0),
          x: acc.x + (x ?? 0),
          y: acc.y + (y ?? 0),
          rotation: acc.rotation + (rotation ?? 0),
          height: acc.height + height,
        };
      },
      { alpha: 0, x: 0, y: 0, rotation: 0, height: 0 },
    ));
    ({
      color: this._color,
      gif: this._gif,
      incline: this._incline,
      scaleX: this._scaleX,
      scaleY: this._scaleY,
      text: this._text,
    } = this.handleExtendedEventLayer(beat / this._data.bpmfactor, 0));
  }

  handleSpeed(
    beat: number,
    layerIndex: number,
    events: SpeedEvent[] | null | undefined,
    cur: number[],
  ) {
    while (cur.length < layerIndex + 1) {
      cur.push(0);
    }
    if (events && events.length > 0) {
      if (cur[layerIndex] > 0 && beat <= events[cur[layerIndex]].startBeat) {
        cur[layerIndex] = 0;
        this._lastHeight = 0;
      }
      while (cur[layerIndex] < events.length - 1 && beat > events[cur[layerIndex] + 1].startBeat) {
        this._lastHeight +=
          getIntegral(events[cur[layerIndex]], this._scene.bpmList) +
          events[cur[layerIndex]].end *
            (getTimeSec(this._scene.bpmList, events[cur[layerIndex] + 1].startBeat) -
              getTimeSec(this._scene.bpmList, events[cur[layerIndex]].endBeat));
        cur[layerIndex]++;
      }
      let height = this._lastHeight;
      if (beat <= events[cur[layerIndex]].endBeat) {
        height += getIntegral(events[cur[layerIndex]], this._scene.bpmList, beat);
      } else {
        height +=
          getIntegral(events[cur[layerIndex]], this._scene.bpmList) +
          events[cur[layerIndex]].end *
            (getTimeSec(this._scene.bpmList, beat) -
              getTimeSec(this._scene.bpmList, events[cur[layerIndex]].endBeat));
      }
      return height;
    } else {
      return 0;
    }
  }

  handleEvent(
    beat: number,
    layerIndex: number,
    events: (Event | ColorEvent | GifEvent | TextEvent)[] | null | undefined,
    cur: number[],
    fillInBetween = true,
  ) {
    while (cur.length < layerIndex + 1) {
      cur.push(0);
    }
    if (events && events.length > 0) {
      if (cur[layerIndex] > 0 && beat <= events[cur[layerIndex]].startBeat) {
        cur[layerIndex] = 0;
      }
      while (cur[layerIndex] < events.length - 1 && beat > events[cur[layerIndex] + 1].startBeat) {
        cur[layerIndex]++;
      }
      if (
        !fillInBetween &&
        (beat <= events[cur[layerIndex]].startBeat || beat > events[cur[layerIndex]].endBeat)
      ) {
        return undefined;
      }
      return getEventValue(beat, events[cur[layerIndex]]);
    } else {
      return undefined;
    }
  }

  handleEventLayer(
    beat: number,
    layerIndex: number,
  ): {
    alpha: number | undefined;
    x: number | undefined;
    y: number | undefined;
    rotation: number | undefined;
    height: number;
  } {
    const layer = this._data.eventLayers[layerIndex];
    if (!layer)
      return { alpha: undefined, x: undefined, y: undefined, rotation: undefined, height: 0 };

    return {
      alpha: this.handleEvent(beat, layerIndex, layer.alphaEvents, this._curAlpha) as
        | number
        | undefined,
      x: this.handleEvent(beat, layerIndex, layer.moveXEvents, this._curX) as number | undefined,
      y: this.handleEvent(beat, layerIndex, layer.moveYEvents, this._curY) as number | undefined,
      rotation: this.handleEvent(beat, layerIndex, layer.rotateEvents, this._curRot) as
        | number
        | undefined,
      height: this.handleSpeed(beat, layerIndex, layer.speedEvents, this._curSpeed),
    };
  }

  handleExtendedEventLayer(
    beat: number,
    layerIndex: number,
  ): {
    color: number[] | undefined;
    gif: number | undefined;
    incline: number | undefined;
    scaleX: number | undefined;
    scaleY: number | undefined;
    text: string | undefined;
  } {
    const extended = this._data.extended;
    if (!extended)
      return {
        color: undefined,
        gif: undefined,
        incline: undefined,
        scaleX: undefined,
        scaleY: undefined,
        text: undefined,
      };

    return {
      color: this.handleEvent(beat, layerIndex, extended.colorEvents, this._curColor) as
        | number[]
        | undefined,
      gif: this.handleEvent(beat, layerIndex, extended.gifEvents, this._curGif, false) as
        | number
        | undefined,
      incline: this.handleEvent(beat, layerIndex, extended.inclineEvents, this._curIncline) as
        | number
        | undefined,
      scaleX: this.handleEvent(beat, layerIndex, extended.scaleXEvents, this._curScaleX) as
        | number
        | undefined,
      scaleY: this.handleEvent(beat, layerIndex, extended.scaleYEvents, this._curScaleY) as
        | number
        | undefined,
      text: this.handleEvent(beat, layerIndex, extended.textEvents, this._curText) as
        | string
        | undefined,
    };
  }

  updateMask() {
    if (this._noteMask === null) return;
    const halfScreenWidth = this._scene.sys.canvas.width / 2;
    const halfScreenHeight = this._scene.sys.canvas.height / 2;
    const vector = this.vector;
    vector.scale(dot([this.x - halfScreenWidth, this.y - halfScreenHeight], [vector.x, vector.y]));
    vector.add(new Phaser.Math.Vector2(halfScreenWidth, halfScreenHeight));
    this._noteMask.setPosition(vector.x, vector.y);
    this._noteMask.setRotation(this._line.rotation);
    this._noteMask.clear();
    const rectWidth = this._line.displayWidth;
    const rectHeight = this._scene.sys.canvas.width ** 2 + this._scene.sys.canvas.height ** 2;
    this._noteMask.fillRect(-rectWidth / 2, -rectHeight / 2, rectWidth, rectHeight);
  }

  calculateHeight(beat: number) {
    return this._data.eventLayers.reduce(
      (acc, _, i) =>
        acc + this.handleSpeed(beat, i, this._data.eventLayers[i]?.speedEvents, this._curSpeed),
      0,
    );
  }

  addNote(note: PlainNote | LongNote, container: GameObjects.Container) {
    note.line = this;
    this._notes.push(note);
    container.add(note);
  }

  addToJudgeWindow(note: PlainNote | LongNote) {
    this._judgeWindow.push(note);
  }

  removeFromJudgeWindow(note: PlainNote | LongNote) {
    this._judgeWindow = this._judgeWindow.filter((n) => n !== note);
  }

  setParent(parent: Line) {
    this._parent = parent;
  }

  getLineTexture(key: string) {
    return this._scene.textures.exists(key) ? key : 'asset-line.png';
  }

  attachVideo(video: Video) {
    this._attachedVideos.push(video);
    this._hasAttach = true;
    this._line.clearTint();
    this._line.setVisible(!!this._data.appearanceOnAttach || this._hasText);
  }

  public get notes() {
    return this._notes;
  }

  public get data() {
    return this._data;
  }

  public get x() {
    return this._line.x;
  }

  public get y() {
    return this._line.y;
  }

  public get rotation() {
    return this._line.rotation;
  }

  public get vector() {
    return new Phaser.Math.Vector2(Math.cos(this._line.rotation), Math.sin(this._line.rotation));
  }

  public get alpha() {
    return this._line.alpha;
  }

  public get incline() {
    return this._incline;
  }

  public get judgeWindow() {
    return this._judgeWindow;
  }

  public get elements() {
    return [this._line, ...Object.values(this._noteContainers)];
  }

  public get index() {
    return this._index;
  }

  public get debug() {
    return this._debug;
  }

  setVisible(visible: boolean) {
    [
      !this._hasAttach || this._data.appearanceOnAttach ? this._line : undefined,
      ...Object.values(this._noteContainers),
    ].forEach((obj) => {
      obj?.setVisible(visible);
    });
  }
}
