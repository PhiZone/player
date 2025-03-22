import type { MediaOptions } from '$lib/types';
import { EventBus } from '../EventBus';
import {
  combineStreams,
  composeAudio,
  convertAudio,
  finishVideo,
  setupVideo,
} from './ffmpeg/tauri';
import type { Game } from '../scenes/Game';
import Worker from '../../workers/FrameSender?worker';
import { mixAudio } from './rodio';
import { download, getTimeSec, urlToBase64 } from '../utils';
import { videoDir, join, tempDir } from '@tauri-apps/api/path';
import { base } from '$app/paths';
import { mkdir, remove, writeFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { ensafeFilename } from '$lib/utils';
import moment from 'moment';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Signal } from '../objects/Signal';

export class Renderer {
  private _scene: Game;
  private _options: MediaOptions;
  private _started: number;
  private _frameCount: number = 0;
  private _isRendering: boolean = false;
  private _isStopped: boolean = false;
  private _endingLoopsToRender: number;
  private _tempDir: string;
  private _length: number;

  private _worker: Worker;

  constructor(scene: Game, mediaOptions: MediaOptions) {
    this._scene = scene;
    this._options = mediaOptions;
    this._started = scene.game.getTime();
    this._endingLoopsToRender = mediaOptions.endingLoopsToRender;
    this._length = scene.song.duration + 2 + (mediaOptions.endingLoopsToRender * 192) / 7;
    this._worker = new Worker();
  }

  async setup() {
    const frameRate = this._options.frameRate;
    const canvas = this._scene.game.canvas;
    const width = canvas.width;
    const height = canvas.height;

    this._tempDir = await join(await tempDir(), 'cn.phizone.player', crypto.randomUUID());
    await mkdir(this._tempDir, { recursive: true });
    const videoFile = await join(this._tempDir, 'video-stream.mp4');

    await setupVideo(
      videoFile,
      [width, height],
      frameRate,
      this._options.videoCodec,
      this._options.videoBitrate,
    );

    this._worker.onmessage = async (event: {
      data: {
        proceed: boolean;
        finished: boolean;
      };
    }) => {
      const { proceed, finished } = event.data;
      if (finished) {
        EventBus.emit('video-rendering-finished');
        await this.proceed(videoFile);
        return;
      }
      if (!this._isRendering && proceed) {
        this.setTick(this._frameCount / frameRate);
      }
      this._isRendering = proceed;
      EventBus.emit('rendering-detail', proceed ? 'Rendering frames' : 'Waiting for FFmpeg');
    };

    this._isRendering = true;
    EventBus.emit('rendering-detail', 'Rendering frames');

    this._scene.game.loop.stop();
    this.setTick(0);

    this._scene.game.events.addListener('postrender', () => {
      if (this._isStopped) return;
      this._scene.renderer.snapshot((param) => {
        const rgbaBuffer = param as Uint8Array<ArrayBuffer>;
        const buffer = new Uint8Array((rgbaBuffer.length / 4) * 3);

        for (let i = 0, j = 0; i < rgbaBuffer.length; i += 4, j += 3) {
          buffer[j] = rgbaBuffer[i];
          buffer[j + 1] = rgbaBuffer[i + 1];
          buffer[j + 2] = rgbaBuffer[i + 2];
        }

        this._worker.postMessage({ data: buffer }, [buffer.buffer]);
        EventBus.emit('rendering', this._frameCount++);
      }, 'raw');
      if (this._isRendering) {
        this.setTick(this._frameCount / frameRate);
      }
    });

    EventBus.on('render-stop', async () => {
      this.stopRendering();
    });

    listen('stream-combination-finished', async (event) => {
      EventBus.emit('rendering-finished', event.payload);
      EventBus.emit('rendering-detail', 'Finished');
      // await remove(this._tempDir, { recursive: true });
    });
  }

  async setTick(progress: number) {
    this._scene.clock.setTime(progress - 1);
    await this._scene.updateVideoTicks(this._scene.getTimeSec(progress - 1));
    requestAnimationFrame(() => {
      this._scene.game.loop.step(this._started + progress * 1000);
    });
  }

  stopRendering() {
    this._isRendering = false;
    this._isStopped = true;
    this._worker.postMessage({ data: false });
    EventBus.emit('rendering-detail', 'Waiting for FFmpeg');
  }

  async proceed(videoFile: string) {
    EventBus.emit('rendering-detail', 'Preparing audio assets');
    const sounds = [
      ...(this._scene.preferences.hitSoundVolume > 0
        ? [
            { key: 'tap', data: await urlToBase64(`${base}/game/hitsounds/Tap.wav`) },
            { key: 'drag', data: await urlToBase64(`${base}/game/hitsounds/Drag.wav`) },
            { key: 'flick', data: await urlToBase64(`${base}/game/hitsounds/Flick.wav`) },
          ]
        : []),
      ...(this._scene.preferences.hitSoundVolume > 0 && Math.ceil(this._endingLoopsToRender) > 0
        ? [{ key: 'grade-hit', data: await urlToBase64(`${base}/game/ending/GradeHit.wav`) }]
        : []),
      ...(this._scene.preferences.musicVolume > 0 && Math.ceil(this._endingLoopsToRender) > 0
        ? [
            {
              key: 'results',
              data: await urlToBase64(
                `${base}/game/ending/LevelOver${this._scene.metadata.levelType}.wav`,
              ),
            },
          ]
        : []),
    ];
    const timestamps = [
      ...Array.from(
        {
          length:
            this._scene.preferences.hitSoundVolume > 0 && Math.ceil(this._endingLoopsToRender) > 0
              ? 1
              : 0,
        },
        () => ({
          sound: 'grade-hit',
          time: this._scene.song.duration + 2,
          volume: this._scene.preferences.hitSoundVolume,
        }),
      ),
      ...Array.from(
        {
          length:
            this._scene.preferences.musicVolume > 0 ? Math.ceil(this._endingLoopsToRender) : 0,
        },
        (_, i) => ({
          sound: 'results',
          time: this._scene.song.duration + 2 + (i * 192) / 7,
          volume: this._scene.preferences.musicVolume,
        }),
      ),
    ];

    let customHitsoundCount = 0;

    if (this._scene.preferences.hitSoundVolume > 0) {
      for (const line of this._scene.chart.judgeLineList) {
        if (!line.notes) continue;
        for (const note of line.notes.filter((note) => !note.isFake)) {
          let sound = note.type === 4 ? 'drag' : note.type === 3 ? 'flick' : 'tap';
          if (note.hitsound) {
            const asset = this._scene.audioAssets.find((x) => x.key === `asset-${note.hitsound}`);
            if (asset) {
              sounds.push({
                key: note.hitsound,
                data: await this.convertAudio(asset.url, note.hitsound),
              });
              sound = note.hitsound;
              customHitsoundCount++;
            } else {
              alert(`Missing hit sound asset: ${note.hitsound}`);
            }
          }
          timestamps.push({
            sound,
            time: getTimeSec(this._scene.bpmList, note.startBeat) + 1 + this._scene.offset / 1000,
            volume: this._scene.preferences.hitSoundVolume,
          });
        }
      }
    }

    const hitsoundsFile = await join(this._tempDir, 'hitsounds.wav');
    const songFile = await join(this._tempDir, 'song.tmp');
    const finalAudio = await join(this._tempDir, 'audio-stream.aac');

    if (customHitsoundCount > 0) {
      const signal = new Signal(customHitsoundCount);
      listen('audio-conversion-finished', () => {
        signal.emit();
      });
      await signal.wait();
    }

    EventBus.emit('rendering-detail', 'Retrieving song');
    await writeFile(
      songFile,
      new Uint8Array(await (await download(this._scene.songUrl, 'song')).arrayBuffer()),
    );

    const renderDestDir = await join(
      this._options.exportPath ?? (await join(await videoDir(), 'PhiZone Player')),
      ensafeFilename(`${this._scene.metadata.title} [${this._scene.metadata.level}]`),
    );
    await mkdir(renderDestDir, { recursive: true });
    const renderOutput = await join(renderDestDir, `${moment().format('YYYY-MM-DD_HH-mm-ss')}.mp4`);
    await mixAudio(songFile, this._scene.preferences.musicVolume, sounds, timestamps, this._length, String(this._options.audioBitrate), videoFile, renderOutput);
    EventBus.emit('rendering-detail', 'Mixing Audio');
    listen('audio-composition-finished', async () => {
      EventBus.emit('audio-rendering-finished');
    });
  }

  async convertAudio(url: string, name: string) {
    const input = await join(this._tempDir, `hitsound-${name}`);
    const output = await join(this._tempDir, `hitsound-${name}.wav`);
    await writeFile(
      input,
      new Uint8Array(await (await download(url, `hit sound ${name}`)).arrayBuffer()),
    );
    await convertAudio(input, output);
    return output;
  }

  async cancel() {
    this._isRendering = false;
    this._isStopped = true;
    await finishVideo();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await remove(this._tempDir, { recursive: true });
    await getCurrentWindow().close();
  }

  public get length() {
    return this._length;
  }

  public get frameCount() {
    return this._frameCount;
  }
}
