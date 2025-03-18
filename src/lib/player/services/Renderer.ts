import type { MediaOptions } from '$lib/types';
import { EventBus } from '../EventBus';
import { setupVideo } from '../ffmpeg/tauri';
import type { Game } from '../scenes/Game';
import Worker from '../../workers/FrameSender.ts?worker';

const FALLBACK_OUTPUT_FILE = 'output.mp4';

export class Renderer {
  private _scene: Game;
  private _started: number;
  private _frameCount: number = 0;
  private _isRendering: boolean = false;
  private _worker: Worker;

  constructor(scene: Game, mediaOptions: MediaOptions) {
    this._scene = scene;
    this._started = scene.game.getTime();
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
      };
    }) => {
      const { proceed } = event.data;
      this._isRendering = proceed;
      if (proceed) {
        this.setTick(++this._frameCount / frameRate);
      }
    };

    this._isRendering = true;

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
    if (this._isRendering) {
      this._isRendering = false;
      this._worker.postMessage({ data: false });
    }
  }
}
