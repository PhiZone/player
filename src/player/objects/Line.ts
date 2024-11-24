import { GameObjects } from 'phaser';
import { type Event, type JudgeLine, type SpeedEvent } from '../types';
import { LongNote } from './LongNote';
import { PlainNote } from './PlainNote';
import { getIntegral, getLineColor, getTimeSec, getVal, processEvents, toBeats } from '../utils';
import type { Game } from '../scenes/Game';

export class Line {
  private _scene: Game;
  private _num: number;
  private _data: JudgeLine;
  private _line: GameObjects.Image | GameObjects.Sprite;
  private _parent: Line | null = null;
  private _flickContainer: GameObjects.Container;
  private _tapContainer: GameObjects.Container;
  private _dragContainer: GameObjects.Container;
  private _holdContainer: GameObjects.Container;
  private _notes: (PlainNote | LongNote)[] = [];
  private _hasCustomTexture: boolean = false;
  private _hasGifTexture: boolean = false;
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

  private _curColor: number = 0;
  private _curGif: number = 0;
  private _curIncline: number = 0;
  private _curScaleX: number = 0;
  private _curScaleY: number = 0;
  private _curText: number = 0;

  private _opacity: number = 0;
  private _x: number = 0;
  private _y: number = 0;
  private _rotation: number = 0;
  private _height: number = 0;

  private _lastUpdate: number = -Infinity;

  constructor(scene: Game, lineData: JudgeLine, num: number, precedence: number) {
    this._scene = scene;
    this._num = num;
    this._data = lineData;
    this._hasCustomTexture = lineData.Texture !== 'line.png';
    this._hasGifTexture = lineData.Texture.toLowerCase().endsWith('.gif');
    this._line = this._hasGifTexture
      ? new GameObjects.Sprite(scene, 0, 0, `asset-${lineData.Texture}`).play(
          `asset-${lineData.Texture}`,
        )
      : new GameObjects.Image(scene, 0, 0, `asset-${lineData.Texture}`);
    this._line.setScale(this._scene.p(1)); // previously 1.0125 (according to the official definition that a line is 3 times as wide as the screen)
    this._line.setDepth(2 + precedence);
    if (!this._hasCustomTexture) this._line.setTint(getLineColor(scene));

    this._holdContainer = this.createContainer(3);
    this._dragContainer = this.createContainer(4);
    this._tapContainer = this.createContainer(5);
    this._flickContainer = this.createContainer(6);

    if (scene.preferences.chartFlipping & 1) {
      this._xModifier = -1;
      this._rotationModifier = -1;
    }
    if (scene.preferences.chartFlipping & 2) {
      this._yModifier = -1;
      this._rotationModifier = (-1 * this._xModifier) as 1 | -1;
      this._rotationOffset = 180;
    }

    // this._flickContainer.add(scene.add.rectangle(0, 0, 10, 10, 0x00ff00).setOrigin(0.5));
    // this._flickContainer.add(
    //   scene.add
    //     .text(0, 20, num.toString(), {
    //       fontFamily: 'Outfit',
    //       fontSize: 25,
    //       color: '#ffffff',
    //       align: 'center',
    //     })
    //     .setOrigin(0.5),
    // );

    this.setVisible(false);
    scene.add.existing(this._line);

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

    if (this._data.notes) {
      this._data.notes.forEach((note) => {
        note.startBeat = toBeats(note.startTime);
        note.endBeat = toBeats(note.endTime);
      });
      this._data.notes.sort((a, b) => a.startBeat - b.startBeat);
      this._data.notes.forEach((data) => {
        let note: PlainNote | LongNote;
        if (data.type === 2) {
          note = new LongNote(scene, data);
          note.setHeadHeight(this.calculateHeight(data.startBeat));
          note.setTailHeight(this.calculateHeight(data.endBeat));
        } else {
          note = new PlainNote(scene, data);
          note.setHeight(this.calculateHeight(data.startBeat));
        }
        this.addNote(note);
        note.setLine(this);
      });
    }
  }

  update(beat: number, time: number, bpm: number) {
    if (time == this._lastUpdate) return;
    this._lastUpdate = time;
    this._line.setScale(this._scene.p(1));
    if (!this._hasCustomTexture) this._line.setTint(getLineColor(this._scene));
    ({
      alpha: this._opacity,
      x: this._x,
      y: this._y,
      rot: this._rotation,
      height: this._height,
    } = this._data.eventLayers.reduce(
      (acc, _, i) => {
        const [nextAlpha, nextX, nextY, nextRot, nextHeight] = this.handleEventLayer(
          beat * this._data.bpmfactor,
          i,
        );
        return {
          alpha: acc.alpha + nextAlpha,
          x: acc.x + nextX,
          y: acc.y + nextY,
          rot: acc.rot + nextRot,
          height: acc.height + nextHeight,
        };
      },
      { alpha: 0, x: 0, y: 0, rot: 0, height: 0 },
    ));
    this._parent?.update(beat, time, bpm);
    this.updateParams();
    this._notes.forEach((note) => {
      note.update(beat * this._data.bpmfactor, this._height);
    });
  }

  destroy() {
    this._line.destroy();
    this._flickContainer.destroy();
    this._tapContainer.destroy();
    this._dragContainer.destroy();
    this._holdContainer.destroy();
    this._notes.forEach((note) => {
      note.destroy();
    });
  }

  updateParams() {
    const { x, y } = this.getPosition();
    const rotation =
      (this._rotationModifier * this._rotation + this._rotationOffset) * (Math.PI / 180);
    this._line.setAlpha(this._opacity / 255);
    [
      this._line,
      this._flickContainer,
      this._tapContainer,
      this._dragContainer,
      this._holdContainer,
    ].forEach((obj) => {
      obj.setPosition(x, y);
      obj.setRotation(rotation);
    });
  }

  getPosition() {
    let x = this._scene.p(this._xModifier * this._x);
    let y = this._scene.o(this._yModifier * this._y);
    if (this._parent !== null) {
      const newX =
        this._parent.x + x * Math.cos(this._parent.rotation) + y * Math.sin(this._parent.rotation);
      const newY =
        this._parent.y + y * Math.cos(this._parent.rotation) - x * Math.sin(this._parent.rotation);
      x = newX;
      y = newY;
    }
    x += this._scene.sys.canvas.width / 2;
    y += this._scene.sys.canvas.height / 2;
    return { x, y };
  }

  createContainer(depth: number) {
    const container = new GameObjects.Container(this._scene);
    container.setDepth(depth);
    this._scene.add.existing(container);
    return container;
  }

  handleSpeed(beat: number, layerIndex: number, events: SpeedEvent[] | undefined, cur: number[]) {
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

  handleEvent(beat: number, layerIndex: number, events: Event[] | undefined, cur: number[]) {
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
      return getVal(beat, events[cur[layerIndex]]);
    } else {
      return 0;
    }
  }

  handleEventLayer(beat: number, layerIndex: number) {
    const layer = this._data.eventLayers[layerIndex];
    if (!layer) return [0, 0, 0, 0, 0];

    return [
      this.handleEvent(beat, layerIndex, layer.alphaEvents, this._curAlpha),
      this.handleEvent(beat, layerIndex, layer.moveXEvents, this._curX),
      this.handleEvent(beat, layerIndex, layer.moveYEvents, this._curY),
      this.handleEvent(beat, layerIndex, layer.rotateEvents, this._curRot),
      this.handleSpeed(beat, layerIndex, layer.speedEvents, this._curSpeed),
    ];
  }

  calculateHeight(beat: number) {
    return this._data.eventLayers.reduce(
      (acc, _, i) =>
        acc + this.handleSpeed(beat, i, this._data.eventLayers[i]?.speedEvents, this._curSpeed),
      0,
    );
  }

  addNote(note: PlainNote | LongNote) {
    this._notes.push(note);
    [this._tapContainer, this._holdContainer, this._flickContainer, this._dragContainer][
      note.note.type - 1
    ].add(note);
  }

  setParent(parent: Line) {
    this._parent = parent;
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

  setVisible(visible: boolean) {
    [
      this._line,
      this._flickContainer,
      this._tapContainer,
      this._dragContainer,
      this._holdContainer,
    ].forEach((obj) => {
      obj.setVisible(visible);
    });
  }
}
