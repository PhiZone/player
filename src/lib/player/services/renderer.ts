import type { MediaOptions } from '$lib/types';
import { EventBus } from '../EventBus';
import { composeAudio, setupVideo } from './ffmpeg/tauri';
import type { Game } from '../scenes/Game';
import Worker from '../../workers/FrameSender?worker';
import { mixAudio } from './rodio';
import { download, getTimeSec, urlToBase64 } from '../utils';
import { join, tempDir } from '@tauri-apps/api/path';
import { base } from '$app/paths';
import { writeFile } from '@tauri-apps/plugin-fs';

const FALLBACK_OUTPUT_FILE = 'output.mp4';

export class Renderer {
  private _scene: Game;
  private _started: number;
  private _frameCount: number = 0;
  private _isRendering: boolean = false;
  private _endingLoopsToRender: number;
  private _length: number;

  private _worker: Worker;

  constructor(scene: Game, mediaOptions: MediaOptions) {
    this._scene = scene;
    this._started = scene.game.getTime();
    this._endingLoopsToRender = mediaOptions.endingLoopsToRender;
    this._length = scene.song.duration + 2 + (mediaOptions.endingLoopsToRender * 192) / 7;
    this._worker = new Worker();

    scene.game.loop.stop();
    this.setTick(0);

    const frameRate = mediaOptions.frameRate;
    const canvas = scene.game.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const renderOutput = localStorage.getItem('renderOutput') ?? FALLBACK_OUTPUT_FILE;

    setupVideo(
      renderOutput,
      [width, height],
      frameRate,
      mediaOptions.videoCodec,
      mediaOptions.videoBitrate,
    );

    this._worker.onmessage = async (event: {
      data: {
        proceed: boolean;
        finished: boolean;
      };
    }) => {
      const { proceed, finished } = event.data;
      if (finished) {
        EventBus.emit('render-finish');
        EventBus.emit('rendering-detail', 'Composing audio');
        await this.createAudio();
        EventBus.emit('rendering-detail', 'Finished');
        return;
      }
      this._isRendering = proceed;
      EventBus.emit(
        'rendering-detail',
        proceed ? 'Rendering frames' : 'Waiting for FFmpeg to catch up',
      );
      if (proceed) {
        this.setTick(++this._frameCount / frameRate);
      }
    };

    this._isRendering = true;
    EventBus.emit('rendering-detail', 'Rendering frames');

    scene.game.events.addListener('postrender', () => {
      scene.renderer.snapshot((param) => {
        const rgbaBuffer = param as Uint8Array<ArrayBuffer>;
        const buffer = new Uint8Array((rgbaBuffer.length / 4) * 3);

        for (let i = 0, j = 0; i < rgbaBuffer.length; i += 4, j += 3) {
          buffer[j] = rgbaBuffer[i];
          buffer[j + 1] = rgbaBuffer[i + 1];
          buffer[j + 2] = rgbaBuffer[i + 2];
        }

        this._worker.postMessage({ data: buffer }, [buffer.buffer]);
        EventBus.emit('rendering', this._frameCount);
      }, 'raw');
      if (this._isRendering) {
        this.setTick(++this._frameCount / frameRate);
      }
    });

    EventBus.on('render-stop', async () => {
      this.stopRendering();
    });
  }

  setTick(progress: number) {
    requestAnimationFrame(() => {
      this._scene.game.loop.step(this._started + progress * 1000);
      this._scene.clock.setTime(progress - 1);
    });
  }

  stopRendering() {
    this._isRendering = false;
    this._worker.postMessage({ data: false });
  }

  async createAudio() {
    const sounds = [
      { key: 'tap', data: await urlToBase64(`${base}/game/hitsounds/Tap.wav`) },
      { key: 'drag', data: await urlToBase64(`${base}/game/hitsounds/Drag.wav`) },
      { key: 'flick', data: await urlToBase64(`${base}/game/hitsounds/Flick.wav`) },
      {
        key: 'results',
        data: await urlToBase64(
          `${base}/game/ending/LevelOver${this._scene.metadata.levelType}.wav`,
        ),
      },
      { key: 'grade-hit', data: await urlToBase64(`${base}/game/ending/GradeHit.wav`) },
    ];
    const timestamps = [
      {
        sound: 'grade-hit',
        time: this._scene.song.duration + 2,
        volume: this._scene.preferences.hitSoundVolume,
      },
      ...Array.from({ length: Math.ceil(this._endingLoopsToRender) }, (_, i) => ({
        sound: 'results',
        time: this._scene.song.duration + 2 + (i * 192) / 7,
        volume: this._scene.preferences.musicVolume,
      })),
    ];

    for (const line of this._scene.chart.judgeLineList) {
      if (!line.notes) continue;
      for (const note of line.notes.filter((note) => !note.isFake)) {
        if (!note?.hitsound) {
          timestamps.push({
            sound: note.type === 4 ? 'drag' : note.type === 3 ? 'flick' : 'tap',
            time: getTimeSec(this._scene.bpmList, note.startBeat) + 1 + this._scene.offset / 1000,
            volume: this._scene.preferences.hitSoundVolume,
          });
          continue;
        }
        const asset = this._scene.audioAssets.find((x) => x.key === `asset-${note.hitsound}`);
        if (!asset) continue;
        sounds.push({ key: note.hitsound, data: await urlToBase64(asset.url) });
        timestamps.push({
          sound: note.hitsound,
          time: getTimeSec(this._scene.bpmList, note.startBeat) + 1 + this._scene.offset / 1000,
          volume: this._scene.preferences.hitSoundVolume,
        });
      }
    }

    const hitsoundsFile = await join(await tempDir(), `${crypto.randomUUID()}.wav`);
    console.log('Composing hitsounds and results music');
    await mixAudio(sounds, timestamps, this._length, hitsoundsFile);

    const songFile = await join(await tempDir(), `${crypto.randomUUID()}.tmp`);
    console.log('Retrieving song');
    await writeFile(
      songFile,
      new Uint8Array(await (await download(this._scene.songUrl, 'song')).arrayBuffer()),
    );

    const finalAudio = await join(await tempDir(), `${crypto.randomUUID()}.aac`);
    console.log('Composing final audio');
    await composeAudio(hitsoundsFile, songFile, finalAudio);
  }

  getLength() {
    return this._length;
  }
}
