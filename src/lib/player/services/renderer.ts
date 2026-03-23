import type { MediaOptions, ResultsMusic, Sound, Timestamp } from '$lib/types';
import { EventBus } from '../EventBus';
import { combineStreams, convertAudio, finishVideo, setupVideo } from './ffmpeg/tauri';
import type { Game } from '../scenes/Game';
import Worker from '../../workers/FrameSender?worker';
import { mixAudio } from './audio';
import { download, getTimeSec, urlToBase64 } from '../utils';
import { videoDir, join, tempDir } from '@tauri-apps/api/path';
import { base } from '$app/paths';
import { mkdir, remove, writeFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { ensafeFilename } from '$lib/utils';
import moment from 'moment';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Signal } from '../objects/Signal';
import { m } from '$lib/paraglide/messages';
import { IS_TAURI, triggerDownload } from '$lib/utils';
import { fetchFile } from '@ffmpeg/util';
import { getFFmpeg, loadFFmpeg } from './ffmpeg';

type BrowserRenderOutput = {
  name: string;
  blob: Blob;
};

const LARGE_REMOTE_FILE_THRESHOLD_BYTES = 128 * 1024 * 1024;
const BROWSER_AUDIO_SAMPLE_RATE = 48_000;

export class Renderer {
  private _scene: Game;
  private _options: MediaOptions;
  private _started: number;
  private _frameCount: number = 0;
  private _isRendering: boolean = false;
  private _isStopped: boolean = false;
  private _resultsLoopsToRender: number;
  private _resultsLoopDuration: number;
  private _resultsDuration: number;
  private _resultsBpm: number;
  private _tempDir: string;
  private _length: number;

  private _worker: Worker;
  private _frameWritePromise: Promise<void> = Promise.resolve();
  private _browserFrameWidth: number = 0;
  private _browserFrameHeight: number = 0;
  private _browserFrameCanvas: HTMLCanvasElement | null = null;
  private _browserFrameContext: CanvasRenderingContext2D | null = null;
  private _browserFinalizePromise: Promise<void> | null = null;

  constructor(scene: Game, mediaOptions: MediaOptions, resultsMusic: ResultsMusic<string>) {
    this._scene = scene;
    this._options = mediaOptions;
    this._started = scene.game.getTime();
    this._resultsBpm = resultsMusic.bpm;
    const beatLength = 60 / this._resultsBpm;
    this._resultsLoopsToRender = mediaOptions.resultsLoopsToRender;
    this._resultsLoopDuration = beatLength * resultsMusic.beats;
    this._resultsDuration = this._resultsLoopsToRender * this._resultsLoopDuration;
    this._length = scene.song.duration + 2 + this._resultsDuration;
  }

  async setup() {
    if (!IS_TAURI) {
      await this.setupBrowser();
      return;
    }

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
      this._length,
      this._options.videoCodec,
      this._options.videoBitrate,
    );

    console.log('[Renderer] Setting up FrameSender');
    this._worker = new Worker();

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
      EventBus.emit(
        'rendering-detail',
        proceed
          ? m['rendering_details.rendering_frames']()
          : m['rendering_details.waiting_for_ffmpeg'](),
      );
    };

    this._isRendering = true;
    EventBus.emit('rendering-detail', m['rendering_details.rendering_frames']());

    const sharedBuffer = new SharedArrayBuffer(canvas.width * canvas.height * 3);
    const sharedView = new Uint8Array(sharedBuffer);
    const rawBufferView = new Uint8Array(new ArrayBuffer(canvas.width * canvas.height * 4));

    this._worker.postMessage({ type: 'init', buffer: sharedBuffer });

    this._scene.game.events.on('prerender', () => {
      if (this._isStopped) return;

      (this._scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer).snapshot(
        () => {
          for (let i = 0, j = 0; i < rawBufferView.length; i += 4, j += 3) {
            sharedView[j] = rawBufferView[i];
            sharedView[j + 1] = rawBufferView[i + 1];
            sharedView[j + 2] = rawBufferView[i + 2];
          }
          this._worker.postMessage({ type: 'frame', frameNumber: this._frameCount++ });
          EventBus.emit('rendering', this._frameCount);

          if (!this._options.vsync && this._isRendering) {
            this.setTick(this._frameCount / frameRate);
          }
        },
        'raw',
        undefined,
        rawBufferView,
      );

      if (this._options.vsync) {
        this._isRendering = false;
      }
    });

    EventBus.on('render-stop', async () => {
      this.stopRendering();
    });

    listen('stream-combination-finished', async (event) => {
      EventBus.emit('rendering-finished', event.payload);
      EventBus.emit('rendering-detail', m['rendering_details.finished']());
      await remove(this._tempDir, { recursive: true });
    });

    this.setTick(0);
  }

  private async setupBrowser() {
    const frameRate = this._options.frameRate;
    const canvas = this._scene.game.canvas;
    const width = canvas.width;
    const height = canvas.height;

    this._browserFrameWidth = width;
    this._browserFrameHeight = height;
    this._browserFrameCanvas = document.createElement('canvas');
    this._browserFrameCanvas.width = width;
    this._browserFrameCanvas.height = height;
    this._browserFrameContext = this._browserFrameCanvas.getContext('2d', {
      willReadFrequently: true,
    });

    if (!this._browserFrameContext) {
      throw new Error('Unable to initialize browser render frame canvas context.');
    }

    const ffmpeg = getFFmpeg();
    if (!ffmpeg.loaded) {
      EventBus.emit('rendering-detail', m.loading({ name: 'FFmpeg' }));
      await loadFFmpeg();
    }

    this._isRendering = true;
    EventBus.emit('rendering-detail', m['rendering_details.rendering_frames']());

    const rawBufferView = new Uint8Array(new ArrayBuffer(width * height * 4));

    this._scene.game.events.on('prerender', () => {
      if (this._isStopped || !this._isRendering) return;

      this._isRendering = false;

      (this._scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer).snapshot(
        () => {
          const frameNumber = this._frameCount++;
          const frameCopy = new Uint8Array(rawBufferView);

          this._frameWritePromise = this._frameWritePromise
            .then(async () => {
              await this.writeBrowserFrame(frameNumber, frameCopy);
              EventBus.emit('rendering', this._frameCount);
            })
            .then(() => {
              if (this._isStopped) return;
              this._isRendering = true;
              this.setTick(this._frameCount / frameRate);
            })
            .catch((error) => {
              console.error('[Renderer] Failed to encode browser frame:', error);
              this._isStopped = true;
              EventBus.emit('rendering-detail', String(error));
            });
        },
        'raw',
        undefined,
        rawBufferView,
      );
    });

    EventBus.on('render-stop', async () => {
      if (!this._browserFinalizePromise) {
        this._browserFinalizePromise = (async () => {
          this.stopRendering();
          await this._frameWritePromise;
          EventBus.emit('video-rendering-finished');
          await this.finalizeBrowser();
        })();
      }

      await this._browserFinalizePromise;
    });

    this.setTick(0);
  }

  private async writeBrowserFrame(frameNumber: number, rgbaFrame: Uint8Array) {
    if (!this._browserFrameCanvas || !this._browserFrameContext) {
      throw new Error('Browser frame canvas is unavailable.');
    }

    const frameName = `frame_${frameNumber.toString().padStart(8, '0')}.png`;
    const imageData = new ImageData(
      new Uint8ClampedArray(rgbaFrame),
      this._browserFrameWidth,
      this._browserFrameHeight,
    );

    this._browserFrameContext.putImageData(imageData, 0, 0);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      this._browserFrameCanvas!.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create PNG frame blob.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });

    await getFFmpeg().writeFile(frameName, new Uint8Array(await pngBlob.arrayBuffer()));
  }

  private async resolveBrowserSongInput(): Promise<{ filename: string; data: Uint8Array }> {
    const songUrl = this._scene.songUrl;
    const safeInputName = 'song-input';

    if (!songUrl.startsWith('blob:') && !songUrl.startsWith('data:')) {
      try {
        const head = await fetch(songUrl, { method: 'HEAD' });
        const contentLength = Number(head.headers.get('content-length') ?? '0');
        if (Number.isFinite(contentLength) && contentLength >= LARGE_REMOTE_FILE_THRESHOLD_BYTES) {
          EventBus.emit('rendering-detail', m['rendering_details.retrieving_song']());
          const blob = await download(songUrl, 'song');
          return {
            filename: safeInputName,
            data: new Uint8Array(await blob.arrayBuffer()),
          };
        }
      } catch {
        // Ignore HEAD errors and fall back to direct fetchFile below.
      }
    }

    return {
      filename: safeInputName,
      data: await fetchFile(this._scene.songUrl),
    };
  }

  private async buildSyntheticMixInputs() {
    const sounds: Sound[] = [
      ...(this._scene.preferences.hitSoundVolume > 0
        ? [
            { key: 'tap', data: await urlToBase64(this._scene.respack.getHitSound('Tap')) },
            { key: 'drag', data: await urlToBase64(this._scene.respack.getHitSound('Drag')) },
            { key: 'flick', data: await urlToBase64(this._scene.respack.getHitSound('Flick')) },
          ]
        : []),
      ...(this._scene.preferences.hitSoundVolume > 0 && Math.ceil(this._resultsDuration) > 0
        ? [{ key: 'grade-hit', data: await urlToBase64(`${base}/game/ending/GradeHit.wav`) }]
        : []),
      ...(this._scene.preferences.musicVolume > 0 && Math.ceil(this._resultsDuration) > 0
        ? [
            {
              key: 'results',
              data: await urlToBase64(
                this._scene.respack.getResultsMusic(this._scene.metadata.levelType).file,
              ),
            },
          ]
        : []),
    ];

    const timestamps: Timestamp[] = [
      ...Array.from(
        {
          length:
            this._scene.preferences.hitSoundVolume > 0 && Math.ceil(this._resultsDuration) > 0
              ? 1
              : 0,
        },
        () => ({
          sound: 'grade-hit',
          time: this._scene.song.duration + 2,
          volume: this._scene.preferences.hitSoundVolume,
          rate: this._resultsBpm / 140,
        }),
      ),
      ...Array.from(
        {
          length:
            this._scene.preferences.musicVolume > 0 && Math.ceil(this._resultsDuration) > 0
              ? Math.ceil(this._resultsLoopsToRender)
              : 0,
        },
        (_, i) => ({
          sound: 'results',
          time: this._scene.song.duration + 2 + i * this._resultsLoopDuration,
          volume: this._scene.preferences.musicVolume,
        }),
      ),
    ];

    if (this._scene.autoplay && this._scene.preferences.hitSoundVolume > 0) {
      for (const line of this._scene.chart.judgeLineList) {
        if (!line.notes) continue;
        for (const note of line.notes.filter((n) => !n.isFake)) {
          let sound = note.type === 4 ? 'drag' : note.type === 3 ? 'flick' : 'tap';

          if (note.hitsound) {
            const asset = this._scene.audioAssets.find((x) => x.key === `asset-${note.hitsound}`);
            if (asset) {
              sounds.push({
                key: note.hitsound,
                data: await urlToBase64(asset.url),
              });
              sound = note.hitsound;
            } else {
              alert(m.error_hitsound_missing({ name: note.hitsound }));
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

    return { sounds, timestamps };
  }

  private encodePcm16Wav(
    channels: Float32Array[],
    sampleRate: number,
    length: number,
  ): ArrayBuffer {
    const numChannels = channels.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
        const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, pcm, true);
        offset += 2;
      }
    }

    return buffer;
  }

  private async createSyntheticHitsoundsBlob(sounds: Sound[], timestamps: Timestamp[]) {
    const totalSamples = Math.ceil(this._length * BROWSER_AUDIO_SAMPLE_RATE);
    const outputL = new Float32Array(totalSamples);
    const outputR = new Float32Array(totalSamples);

    const decoder = new AudioContext({ sampleRate: BROWSER_AUDIO_SAMPLE_RATE });
    const decodedByKey = new Map<string, AudioBuffer>();

    try {
      for (const sound of sounds) {
        if (decodedByKey.has(sound.key)) continue;
        const blob = await (await fetch(sound.data)).blob();
        const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
        decodedByKey.set(sound.key, decoded);
      }
    } finally {
      await decoder.close();
    }

    for (const stamp of timestamps) {
      const buffer = decodedByKey.get(stamp.sound);
      if (!buffer) continue;

      const startSample = Math.max(0, Math.floor(stamp.time * BROWSER_AUDIO_SAMPLE_RATE));
      const gain = Math.max(0, stamp.volume);
      const rate = Math.max(0.01, stamp.rate ?? 1);

      const srcL = buffer.getChannelData(0);
      const srcR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : srcL;

      const maxWritable = totalSamples - startSample;
      if (maxWritable <= 0) continue;

      for (let i = 0; i < maxWritable; i++) {
        const srcIndex = Math.floor(i * rate);
        if (srcIndex >= srcL.length) break;

        outputL[startSample + i] += srcL[srcIndex] * gain;
        outputR[startSample + i] += srcR[srcIndex] * gain;
      }
    }

    const wav = this.encodePcm16Wav([outputL, outputR], BROWSER_AUDIO_SAMPLE_RATE, totalSamples);
    return new Blob([wav], { type: 'audio/wav' });
  }

  private async finalizeBrowser() {
    const ffmpeg = getFFmpeg();

    const runFfmpegWithProgress = async (
      args: string[],
      detailLabel: string,
      phase: 'encode' | 'combine',
    ) => {
      const onProgress = ({ progress }: { progress: number }) => {
        const ratio = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
        const pct = (ratio * 100).toFixed(1);
        EventBus.emit('rendering-detail', `${detailLabel} (${pct}%)`);

        // Use a small synthetic tail so browser users can see post-frame FFmpeg activity.
        const base = this._frameCount;
        const span = Math.max(1, Math.ceil(this._options.frameRate * 2));
        const phaseOffset = phase === 'encode' ? 0 : span;
        EventBus.emit('rendering', base + phaseOffset + Math.round(ratio * span));
      };

      ffmpeg.on('progress', onProgress);
      try {
        await ffmpeg.exec(args);
      } finally {
        ffmpeg.off('progress', onProgress);
      }
    };

    EventBus.emit('rendering-detail', m['rendering_details.preparing_audio_assets']());
    const { sounds, timestamps } = await this.buildSyntheticMixInputs();
    EventBus.emit('rendering-detail', m['rendering_details.mixing_audio']());
    const syntheticHitsounds = await this.createSyntheticHitsoundsBlob(sounds, timestamps);
    await ffmpeg.writeFile('hitsounds.wav', new Uint8Array(await syntheticHitsounds.arrayBuffer()));

    EventBus.emit('rendering-detail', m['rendering_details.retrieving_song']());
    const { filename: songInputName, data: songInputData } = await this.resolveBrowserSongInput();
    await ffmpeg.writeFile(songInputName, songInputData);

    EventBus.emit('rendering-detail', m['rendering_details.combining_streams']());

    const frameRate = this._options.frameRate;
    const videoBitrate = `${this._options.videoBitrate}k`;
    const audioBitrate = `${this._options.audioBitrate}k`;
    const outputName = `${ensafeFilename(this._scene.metadata.title ?? 'render')}-${moment().format(
      'YYYY-MM-DD_HH-mm-ss',
    )}.mp4`;

    await runFfmpegWithProgress(
      [
        '-framerate',
        String(frameRate),
        '-i',
        'frame_%08d.png',
        '-c:v',
        this._options.videoCodec,
        '-b:v',
        videoBitrate,
        '-vf',
        'vflip',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-y',
        'video-stream.mp4',
      ],
      'Encoding video stream',
      'encode',
    );

    await runFfmpegWithProgress(
      [
        '-i',
        'video-stream.mp4',
        '-i',
        songInputName,
        '-i',
        'hitsounds.wav',
        '-filter_complex',
        `[1:a]adelay=1000|1000,volume=${this._scene.preferences.musicVolume}[a2];[2:a][a2]amix=inputs=2:normalize=0,alimiter=limit=1.0:level=false:attack=0.1:release=1[a]`,
        '-map',
        '0:v:0',
        '-map',
        '[a]',
        '-b:a',
        audioBitrate,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        '-y',
        'output.mp4',
      ],
      m['rendering_details.combining_streams'](),
      'combine',
    );

    const output = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([(output as Uint8Array).buffer as ArrayBuffer], { type: 'video/mp4' });
    const payload: BrowserRenderOutput = {
      name: outputName,
      blob,
    };

    triggerDownload(blob, outputName, 'rendering');
    EventBus.emit('rendering-finished', payload);
    EventBus.emit('rendering-detail', m['rendering_details.finished']());
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
    if (IS_TAURI) {
      this._worker.postMessage({ type: 'stop' });
    }
    EventBus.emit('rendering-detail', m['rendering_details.waiting_for_ffmpeg']());
  }

  async proceed(videoFile: string) {
    EventBus.emit('rendering-detail', m['rendering_details.preparing_audio_assets']());
    console.log('[Renderer] Preparing audio assets');
    const sounds = [
      ...(this._scene.preferences.hitSoundVolume > 0
        ? [
            { key: 'tap', data: await urlToBase64(this._scene.respack.getHitSound('Tap')) },
            { key: 'drag', data: await urlToBase64(this._scene.respack.getHitSound('Drag')) },
            { key: 'flick', data: await urlToBase64(this._scene.respack.getHitSound('Flick')) },
          ]
        : []),
      ...(this._scene.preferences.hitSoundVolume > 0 && Math.ceil(this._resultsDuration) > 0
        ? [{ key: 'grade-hit', data: await urlToBase64(`${base}/game/ending/GradeHit.wav`) }]
        : []),
      ...(this._scene.preferences.musicVolume > 0 && Math.ceil(this._resultsDuration) > 0
        ? [
            {
              key: 'results',
              data: await urlToBase64(
                this._scene.respack.getResultsMusic(this._scene.metadata.levelType).file,
              ),
            },
          ]
        : []),
    ];
    const timestamps = [
      ...Array.from(
        {
          length:
            this._scene.preferences.hitSoundVolume > 0 && Math.ceil(this._resultsDuration) > 0
              ? 1
              : 0,
        },
        () => ({
          sound: 'grade-hit',
          time: this._scene.song.duration + 2,
          volume: this._scene.preferences.hitSoundVolume,
          rate: this._resultsBpm / 140,
        }),
      ),
      ...Array.from(
        {
          length:
            this._scene.preferences.musicVolume > 0 && Math.ceil(this._resultsDuration) > 0
              ? Math.ceil(this._resultsLoopsToRender)
              : 0,
        },
        (_, i) => ({
          sound: 'results',
          time: this._scene.song.duration + 2 + i * this._resultsLoopDuration,
          volume: this._scene.preferences.musicVolume,
        }),
      ),
    ];

    let customHitsoundCount = 0;

    if (this._scene.autoplay && this._scene.preferences.hitSoundVolume > 0) {
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
              alert(m.error_hitsound_missing({ name: note.hitsound }));
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

    if (customHitsoundCount > 0) {
      const signal = new Signal(customHitsoundCount);
      listen('audio-conversion-finished', () => {
        signal.emit();
      });
      await signal.wait();
    }

    const hitsoundsFile = await join(this._tempDir, 'hitsounds.wav');

    EventBus.emit('rendering-detail', m['rendering_details.mixing_audio']());
    await mixAudio(sounds, timestamps, this._length, hitsoundsFile);

    listen('audio-mixing-finished', async () => {
      EventBus.emit('audio-mixing-finished');
      await this.finalize(videoFile, hitsoundsFile);
    });
  }

  async finalize(videoFile: string, hitsoundsFile: string) {
    const songFile = await join(this._tempDir, 'song.tmp');

    console.log('[Renderer] Retrieving song audio');
    EventBus.emit('rendering-detail', m['rendering_details.retrieving_song']());
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
    console.log('[Renderer] Saving video to', renderOutput);

    EventBus.emit('rendering-detail', m['rendering_details.combining_streams']());
    await combineStreams(
      videoFile,
      songFile,
      hitsoundsFile,
      this._scene.preferences.musicVolume,
      this._options.audioBitrate,
      renderOutput,
    );
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
    if (!IS_TAURI) {
      EventBus.emit('rendering-detail', m.cancel());
      return;
    }

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
