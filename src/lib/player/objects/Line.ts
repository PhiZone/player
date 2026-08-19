import { GameObjects, Math as PhaserMath } from 'phaser';
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
  getEventValue,
  processEvents,
  rgbToHex,
  toBeats,
  processControlNodes,
  isEqual,
} from '../utils';
import type { Game } from '../scenes/Game';
import { NOTE_BASE_SIZE } from '../constants';
import { dot } from 'mathjs';
import type { Video } from './Video';
import { isDebug } from '$lib/utils';

const VISUAL_END_GRACE_SEC = 1;

export class Line {
  private _scene: Game;
  private _index: number;
  private _data: JudgeLine;
  private _line: GameObjects.Image | GameObjects.Sprite | GameObjects.Text;
  private _parent: Line | null = null;
  private _noteContainers: Record<number, GameObjects.Container> = {};
  private _noteMask: GameObjects.Rectangle | null = null;
  private _notes: (PlainNote | LongNote)[] = [];
  private _noteCullBound: number = Infinity;
  private _hasAttach: boolean = false;
  private _hasCustomTexture: boolean = false;
  private _hasAnimatedTexture: boolean = false;
  private _hasText: boolean = false;
  private _xModifier: 1 | -1 = 1;
  private _yModifier: 1 | -1 = 1;
  private _rotationModifier: 1 | -1 = 1;
  private _rotationOffset: 0 | 180 = 0;
  private _rotateWithParent: boolean = false;
  private _integrateSpeedEasings: boolean = false;

  private _curX = [];
  private _curY = [];
  private _curRot = [];
  private _curAlpha = [];
  private _curSpeed = [];
  private _lastHeight = [];

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
  private _textScale: number;
  private _font: string | undefined = undefined;
  private _appliedFont: string | undefined = undefined;
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
    this._textScale = this._scene.p(100);
    this._line = this._hasText
      ? new GameObjects.Text(scene, 0, 0, this._text ?? '', {
          fontFamily: scene.getFont(this._font),
          fontSize: this._textScale,
          color: '#ffffff',
          align: 'left',
        }).setOrigin(0.5)
      : this._hasAnimatedTexture
        ? new GameObjects.Sprite(scene, 0, 0, `asset-${lineData.Texture}`).play(
            `asset-${lineData.Texture}`,
          )
        : new GameObjects.Image(scene, 0, 0, this.getLineTexture(`asset-${lineData.Texture}`));

    this._hasAttach = !!this._data.attachUI;
    this._rotateWithParent = this._data.rotateWithFather ?? false;
    this._integrateSpeedEasings =
      this._data.integrateSpeedEasings ?? this._scene.chart.META.RPEVersion >= 170;
    this._line.setScale(
      (this._hasText ? this._scene.p(50) / this._textScale : this._scene.p(1)) *
        (this._scaleX ?? 1),
      this._hasCustomTexture
        ? (this._hasText ? this._scene.p(50) / this._textScale : this._scene.p(1)) *
            (this._scaleY ?? 1)
        : this._scene.o(1) * this._scene.preferences.lineThickness * (this._scaleY ?? 1.35),
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

    this._data.eventLayers.forEach((layer, i) => {
      processEvents(layer?.alphaEvents, this._scene.timeUtil, i, this._index);
      processEvents(layer?.moveXEvents, this._scene.timeUtil, i, this._index);
      processEvents(layer?.moveYEvents, this._scene.timeUtil, i, this._index);
      processEvents(layer?.rotateEvents, this._scene.timeUtil, i, this._index);
      processEvents(layer?.speedEvents, this._scene.timeUtil, i, this._index);
    });

    if (this._data.extended) {
      processEvents(this._data.extended.colorEvents, this._scene.timeUtil, 'Extended', this._index);
      processEvents(this._data.extended.gifEvents, this._scene.timeUtil, 'Extended', this._index);
      processEvents(
        this._data.extended.inclineEvents,
        this._scene.timeUtil,
        'Extended',
        this._index,
      );
      processEvents(
        this._data.extended.scaleXEvents,
        this._scene.timeUtil,
        'Extended',
        this._index,
      );
      processEvents(
        this._data.extended.scaleYEvents,
        this._scene.timeUtil,
        'Extended',
        this._index,
      );
      processEvents(this._data.extended.textEvents, this._scene.timeUtil, 'Extended', this._index);
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
        note.judgeSize ??= note.size;
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
        this._noteMask = new GameObjects.Rectangle(scene, 0, 0, 1, 1, 0xffffff, 1);
        Object.values(this._noteContainers).forEach((container) => {
          container
            .enableFilters()
            .filters!.internal.addMask(this._noteMask!, false, this._scene.cameras.main, 'world');
        });
      }
    }

    // calculateHeight() uses the same incremental event cursors as playback.
    // Do not leave those cursors at the last note's position when the first
    // frame is rendered (or after a seek); playback must rebuild them from 0.
    this.resetEventState();
  }

  update(beat: number, songTime: number, gameTime: number, forceFullNoteUpdate: boolean = false) {
    if (gameTime == this._lastUpdate) return;
    this._lastUpdate = gameTime;
    if (forceFullNoteUpdate) this.resetEventState();
    this._parent?.update(beat, songTime, gameTime, forceFullNoteUpdate);
    const lineBeat = beat / this._data.bpmfactor;
    const timeSec = this._scene.timeUtil.getTimeSec(lineBeat);
    this.handleEventLayers(lineBeat, timeSec);
    this.updateParams();
    this._noteCullBound =
      this._scene.sys.canvas.height +
      (this._scene.sys.canvas.width / 2) * Math.abs(Math.sin(this._line.rotation));
    if (forceFullNoteUpdate) {
      this._notes.forEach((note) => {
        note.update(lineBeat, songTime, this._height);
      });
      return;
    }
    this.updateVisibleNotes(lineBeat, songTime);
  }

  updateVisibleNotes(beat: number, songTime: number) {
    for (const note of this._notes) {
      if (
        songTime < note.hitTime - note.note.visibleTime ||
        songTime >
          (note instanceof LongNote ? note.endHitTime : note.hitTime) + VISUAL_END_GRACE_SEC ||
        !this.isNoteInCullArea(note)
      ) {
        note.setVisible(false);
        continue;
      }
      note.update(beat, songTime, this._height);
    }
  }

  resetActiveNoteWindow() {
    // Kept for Game's seek reset path. Note eligibility is now derived from
    // absolute time, so there is no cursor or active-note list to rebuild.
  }

  private resetEventState() {
    this._curX = [];
    this._curY = [];
    this._curRot = [];
    this._curAlpha = [];
    this._curSpeed = [];
    this._lastHeight = [];
    this._curColor = [];
    this._curGif = [];
    this._curIncline = [];
    this._curScaleX = [];
    this._curScaleY = [];
    this._curText = [];
  }

  private isNoteInCullArea(note: PlainNote | LongNote) {
    const scale = (this._scene.sys.canvas.height * 2) / 15;
    const offsetScale = this._scene.sys.canvas.height / 900;
    const yModifier = note.note.above === 1 ? -1 : 1;
    const speed = note.note.speed;
    const lineY = this._line.y;
    const cosRotation = Math.cos(this._line.rotation);
    const centerY = this._scene.sys.canvas.height / 2;
    const worldY = (targetHeight: number) => {
      const distance =
        (targetHeight - this._height) * speed * scale + note.note.yOffset * offsetScale;
      return lineY + yModifier * distance * cosRotation;
    };
    const inArea = (targetHeight: number) =>
      Math.abs(worldY(targetHeight) - centerY) <= this._noteCullBound;

    if (note instanceof LongNote) {
      // Once a hold reaches the judgment line, its endpoints can both be
      // outside the viewport while its body is still crossing the line. Keep
      // updating it for the complete judgment interval in that case.
      if (this._scene.timeSec >= note.hitTime && this._scene.timeSec <= note.endHitTime) {
        return true;
      }

      const headY = worldY(note.headTargetHeight);
      const tailY = worldY(note.tailTargetHeight);
      const minY = Math.min(headY, tailY);
      const maxY = Math.max(headY, tailY);
      return maxY >= centerY - this._noteCullBound && minY <= centerY + this._noteCullBound;
    }
    return inArea(note.targetHeight);
  }

  destroy() {
    this._line.destroy();
    this._noteMask?.destroy();
    Object.values(this._noteContainers).forEach((container) => {
      container.destroy();
    });
    this._notes.forEach((note) => {
      note.destroy();
    });
  }

  updateParams() {
    this._line.setScale(
      (this._hasText ? this._scene.p(50) / this._textScale : this._scene.p(1)) *
        (this._scaleX ?? 1),
      this._hasCustomTexture
        ? (this._hasText ? this._scene.p(50) / this._textScale : this._scene.p(1)) *
            (this._scaleY ?? 1)
        : this._scene.o(1) * this._scene.preferences.lineThickness * (this._scaleY ?? 1.35),
    );
    if (this._hasText) {
      const textObj = this._line as GameObjects.Text;
      textObj.setText(this._text ?? '');
      const fontFamily = this._scene.getFont(this._font);
      if (this._appliedFont !== fontFamily) {
        textObj.setFontFamily(fontFamily);
        this._appliedFont = fontFamily;
      }
    }
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
    const rotation = this.getRotation();
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
          this._scene.gameUI.accuracy?.updateAttach(params);
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

  getRotation() {
    let rotation = this._rotationModifier * this._rotation + this._rotationOffset;
    rotation *= Math.PI / 180;
    if (this._parent !== null && this._rotateWithParent) {
      rotation += this._parent.rotation;
    }
    return rotation;
  }

  createContainer(depth: number) {
    const container = new GameObjects.Container(this._scene);
    container.setDepth(depth);
    this._noteContainers[depth] = container;
    this._scene.registerNode(container, `line-${this._index}-cont-${depth}`);
    return container;
  }

  handleEventLayers(beat: number, timeSec: number) {
    let alpha = 0;
    let x = 0;
    let y = 0;
    let rotation = 0;
    let height = 0;
    for (let i = 0; i < this._data.eventLayers.length; i++) {
      const layer = this.handleEventLayer(beat, i, timeSec);
      if (layer.alpha !== undefined) alpha += layer.alpha;
      if (layer.x !== undefined) x += layer.x;
      if (layer.y !== undefined) y += layer.y;
      if (layer.rotation !== undefined) rotation += layer.rotation;
      height += layer.height;
    }
    this._opacity = alpha;
    this._x = x;
    this._y = y;
    this._rotation = rotation;
    this._height = height;
    ({
      color: this._color,
      gif: this._gif,
      incline: this._incline,
      scaleX: this._scaleX,
      scaleY: this._scaleY,
      text: this._text,
      font: this._font,
    } = this.handleExtendedEventLayer(beat, 0, timeSec));
  }

  handleSpeed(
    beat: number,
    layerIndex: number,
    events: SpeedEvent[] | null | undefined,
    cur: number[],
    lastHeight: number[],
    timeSec: number,
  ) {
    while (cur.length < layerIndex + 1) cur.push(0);
    while (lastHeight.length < layerIndex + 1) lastHeight.push(0);
    if (events && events.length > 0) {
      if (cur[layerIndex] > 0 && beat <= events[cur[layerIndex]].startBeat) {
        cur[layerIndex] = 0;
        lastHeight[layerIndex] = 0;
      }
      while (cur[layerIndex] < events.length - 1 && beat > events[cur[layerIndex] + 1].startBeat) {
        lastHeight[layerIndex] +=
          getIntegral(events[cur[layerIndex]], this._integrateSpeedEasings) +
          events[cur[layerIndex]].end *
            (events[cur[layerIndex] + 1].startTimeSec! - events[cur[layerIndex]].endTimeSec!);
        cur[layerIndex]++;
      }
      let height = lastHeight[layerIndex];
      if (beat <= events[cur[layerIndex]].endBeat) {
        height += getIntegral(events[cur[layerIndex]], this._integrateSpeedEasings, beat, timeSec);
      } else {
        height +=
          getIntegral(events[cur[layerIndex]], this._integrateSpeedEasings) +
          events[cur[layerIndex]].end * (timeSec - events[cur[layerIndex]].endTimeSec!);
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
    timeSec: number,
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
      return getEventValue(events[cur[layerIndex]], timeSec);
    } else {
      return undefined;
    }
  }

  handleEventLayer(
    beat: number,
    layerIndex: number,
    timeSec: number,
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
      alpha: this.handleEvent(beat, layerIndex, layer.alphaEvents, this._curAlpha, timeSec) as
        | number
        | undefined,
      x: this.handleEvent(beat, layerIndex, layer.moveXEvents, this._curX, timeSec) as
        | number
        | undefined,
      y: this.handleEvent(beat, layerIndex, layer.moveYEvents, this._curY, timeSec) as
        | number
        | undefined,
      rotation: this.handleEvent(beat, layerIndex, layer.rotateEvents, this._curRot, timeSec) as
        | number
        | undefined,
      height: this.handleSpeed(
        beat,
        layerIndex,
        layer.speedEvents,
        this._curSpeed,
        this._lastHeight,
        timeSec,
      ),
    };
  }

  handleExtendedEventLayer(
    beat: number,
    layerIndex: number,
    timeSec: number,
  ): {
    color: number[] | undefined;
    gif: number | undefined;
    incline: number | undefined;
    scaleX: number | undefined;
    scaleY: number | undefined;
    text: string | undefined;
    font: string | undefined;
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
        font: undefined,
      };

    const text = this.handleEvent(beat, layerIndex, extended.textEvents, this._curText, timeSec) as
      | string
      | undefined;
    const font = extended.textEvents?.[this._curText[layerIndex]]?.font;

    return {
      color: this.handleEvent(beat, layerIndex, extended.colorEvents, this._curColor, timeSec) as
        | number[]
        | undefined,
      gif: this.handleEvent(beat, layerIndex, extended.gifEvents, this._curGif, timeSec, false) as
        | number
        | undefined,
      incline: this.handleEvent(
        beat,
        layerIndex,
        extended.inclineEvents,
        this._curIncline,
        timeSec,
      ) as number | undefined,
      scaleX: this.handleEvent(
        beat,
        layerIndex,
        extended.scaleXEvents,
        this._curScaleX,
        timeSec,
      ) as number | undefined,
      scaleY: this.handleEvent(
        beat,
        layerIndex,
        extended.scaleYEvents,
        this._curScaleY,
        timeSec,
      ) as number | undefined,
      text,
      font,
    };
  }

  updateMask() {
    if (this._noteMask === null) return;
    const halfScreenWidth = this._scene.sys.canvas.width / 2;
    const halfScreenHeight = this._scene.sys.canvas.height / 2;
    const vector = this.vector;
    vector.scale(dot([this.x - halfScreenWidth, this.y - halfScreenHeight], [vector.x, vector.y]));
    vector.add(new PhaserMath.Vector2(halfScreenWidth, halfScreenHeight));
    this._noteMask.setPosition(vector.x, vector.y);
    this._noteMask.setRotation(this._line.rotation);
    const rectWidth = this._line.displayWidth;
    const rectHeight = this._scene.sys.canvas.width ** 2 + this._scene.sys.canvas.height ** 2;
    this._noteMask.setSize(rectWidth, rectHeight);
  }

  calculateHeight(beat: number) {
    const timeSec = this._scene.timeUtil.getTimeSec(beat);
    return this._data.eventLayers.reduce(
      (acc, layer, i) =>
        acc +
        this.handleSpeed(beat, i, layer?.speedEvents, this._curSpeed, this._lastHeight, timeSec),
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
    return new PhaserMath.Vector2(Math.cos(this._line.rotation), Math.sin(this._line.rotation));
  }

  public get alpha() {
    return this._line.alpha;
  }

  public get opacity() {
    return this._opacity;
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
