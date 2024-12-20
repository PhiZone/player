import { GameObjects, Renderer } from 'phaser';
import type { Game } from '../scenes/Game';
import type { AnimatedVariable, RegisteredObject, ShaderEffect, VariableEvent } from '../types';
import { getValue, processEvents, toBeats } from '../utils';

const DEFAULT_VALUE_REGEX = /uniform\s+(\w+)\s+(\w+);\s+\/\/\s+%([^%]+)%/g;

export class ShaderPipeline extends Renderer.WebGL.Pipelines.PostFXPipeline {
  private _scene: Game;
  private _data: ShaderEffect;
  private _container:
    | {
        object: GameObjects.Container;
        depth: number;
        upperDepth: number;
        occupied: { [key: string]: boolean };
      }
    | undefined;
  private _targets: RegisteredObject[] | undefined;
  private _animators: VariableAnimator[] = [];

  constructor(
    game: Phaser.Game,
    postPipelineData: {
      scene: Game;
      fragShader: string;
      data: ShaderEffect;
      target?: {
        object: GameObjects.Container;
        depth: number;
        upperDepth: number;
        occupied: { [key: string]: boolean };
      };
    },
  ) {
    postPipelineData.fragShader = postPipelineData.fragShader
      .replaceAll('uv', 'outTexCoord')
      .replaceAll('screenTexture', 'uMainSampler');
    super({ game, fragShader: postPipelineData.fragShader });
    this._scene = postPipelineData.scene;
    this._data = postPipelineData.data;
    this._data.startBeat = toBeats(this._data.start);
    this._data.endBeat = toBeats(this._data.end);
    this._container = postPipelineData.target;

    [...postPipelineData.fragShader.matchAll(DEFAULT_VALUE_REGEX)].map((uniform) => {
      const type = uniform[1];
      const name = uniform[2];
      const value = uniform[3];

      if (!this._data.vars) this._data.vars = {};
      if (Object.prototype.hasOwnProperty.call(this._data.vars, name)) return;

      switch (type) {
        case 'float': {
          this._data.vars[name] = parseFloat(value);
          break;
        }
        case 'vec2':
        case 'vec3':
        case 'vec4': {
          this._data.vars[name] = value.split(',').map((v) => parseFloat(v.trim()));
          break;
        }
        default: {
          throw Error(`Unknown type of uniform in shader ${this._data.shader}: ${type}`);
        }
      }
    });

    if (this._data.vars) {
      const vars = this._data.vars;
      Object.entries(vars).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          if (typeof value[0] === 'number') {
            vars[key] = this.correctRange(key, value as number[]);
          } else {
            this._animators.push(new VariableAnimator(this, key, value as AnimatedVariable));
          }
        }
      });
    }
  }

  update(beat: number, time: number) {
    this.active = beat > this._data.startBeat && beat <= this._data.endBeat;
    if (!this.active) {
      if (
        this._container &&
        this._targets?.some((target) => target.occupied[this.name]) &&
        !Object.keys(this._container.occupied)
          .filter((key) => key !== this.name)
          .some((key) => this._container!.occupied[key])
      ) {
        console.log('Removing targets from', this.name);
        this._container.object.removeAll();
        this._targets.forEach((target) => {
          target.occupied[this.name] = false;
          // this._scene.add.existing(target.object);
        });
      }
      return;
    }
    if (
      this._data.targetRange &&
      (!this._targets || this._targets?.some((target) => !target.occupied[this.name]))
    ) {
      const range = this._data.targetRange;
      this._targets = this._scene.objects
        .filter((o) => {
          if (Object.keys(o.occupied).some((key) => o.occupied[key])) return false;
          if (o.upperDepth) {
            if ((o.object as GameObjects.Container).list.length === 0) return false;
            if (range.exclusive) {
              return o.depth >= range.minZIndex && o.upperDepth <= range.maxZIndex;
            } else {
              return o.upperDepth > range.minZIndex && o.depth < range.maxZIndex;
            }
          } else {
            return o.depth >= range.minZIndex && o.depth < range.maxZIndex;
          }
        })
        .sort((a, b) => a.depth - b.depth);
      console.log('Adding targets to', this.name);
      this._targets.forEach((target) => {
        target.occupied[this.name] = true;
        this._container?.object.add(target.object);
      });
      console.log(this._targets);
    }
    if (!this.currentShader) {
      console.warn(
        `Shader ${this.name} is not loaded, even if it has ${this._container?.object.count('visible', true)} visible targets.`,
      );
      try {
        this.set1f('time', time / 1000);
      } catch (e) {
        console.log('And thus we have expectedly caught', e);
      }
      return;
    }
    try {
      this.set1f('time', time / 1000);
      this.set2f('screenSize', this.renderer.width, this.renderer.height);
      if (this._data.vars)
        Object.entries(this._data.vars).forEach(([key, value]) => {
          if (typeof value === 'number' || (Array.isArray(value) && typeof value[0] === 'number')) {
            this.setUniform(key, value, beat);
          }
        });
      this._animators.forEach((animator) => animator.update(beat));
    } catch (e) {
      console.error(e);
    }
  }

  setUniform(name: string, value: number | number[] | unknown, beat: number) {
    if (!value && value !== 0) return;
    console.debug(beat.toFixed(3), this.name, name, value);
    if (Array.isArray(value)) {
      if (value.length === 2) this.set2f(name, value[0], value[1]);
      else if (value.length === 3) this.set3f(name, value[0], value[1], value[2]);
      else if (value.length === 4) this.set4f(name, value[0], value[1], value[2], value[3]);
    } else if (typeof value === 'number') this.set1f(name, value);
  }

  correctRange(name: string, value: number[], force = false) {
    if (
      force ||
      (['color', 'rgb', 'rgba'].some((e) => name.toLowerCase().includes(e)) &&
        value.length > 2 &&
        (value[0] > 1 || value[1] > 1 || value[2] > 1 || (value.length > 3 && value[3] > 1)))
    ) {
      value = Array(value.length)
        .fill(0)
        .map((_, i) => value[i] / 255);
      console.warn(
        `Dividing values of ${name} in ${this._data.shader} by 255 as this variable seems to represent an RGB(A) color but has values greater than 1.`,
      );
    }
    return value;
  }
}

class VariableAnimator {
  private _shader: ShaderPipeline;
  private _name: string;
  private _events: VariableEvent[];
  private _cur: number = 0;

  constructor(shader: ShaderPipeline, name: string, events: AnimatedVariable) {
    this._shader = shader;
    this._name = name;
    this._events = events;
    processEvents(this._events);
    if (
      ['color', 'tint', 'rgb', 'rgba'].some((e) => name.toLowerCase().includes(e)) &&
      this._events.some((e) =>
        [e.start, e.end].some(
          (f) =>
            Array.isArray(f) &&
            typeof f[0] === 'number' &&
            f.length > 2 &&
            (f[0] > 1 || f[1] > 1 || f[2] > 1 || (f.length > 3 && f[3] > 1)),
        ),
      )
    ) {
      this._events = this._events.map((event) => ({
        ...event,
        start: this._shader.correctRange(name, event.start as number[], true),
        end: this._shader.correctRange(name, event.end as number[], true),
      }));
    } // shit but elegant !!!???
  }

  update(beat: number) {
    this._shader.setUniform(this._name, this.handleEvent(beat), beat);
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
