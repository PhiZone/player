import type { MediaOptions } from '$lib/types';
import { getAllWindows } from '@tauri-apps/api/window';
import { EventBus } from '../EventBus';
import { setupVideo } from '../ffmpeg/tauri';
import type { Game } from '../scenes/Game';

const FALLBACK_OUTPUT_FILE = 'output.mp4';
const WEBSOCKET_URL = 'ws://localhost:63401';
const FRAME_BATCH_SIZE = 1000;

enum WebSocketState {
  OPEN = 1,
  PAUSED = 2,
  CLOSED = 3,
}

export class Renderer {
  private _scene: Game;
  private _started: number;
  private _ws: WebSocket;
  private _wsState: WebSocketState = WebSocketState.CLOSED;
  private _sentFrameCount: number = 0;
  private _receivedFrameCount: number = 0;
  private _generatedFrameCount: number = 0;
  private _frameQueue: (Uint8Array<ArrayBuffer> | false)[] = [];
  private _isRendering: boolean = false;
  private _isSendingFrame: boolean = false;

  constructor(scene: Game, mediaOptions: MediaOptions) {
    this._scene = scene;
    this._started = scene.game.getTime();

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

    this._ws = new WebSocket(WEBSOCKET_URL);
    this._ws.binaryType = 'arraybuffer';
    this._ws.onopen = () => {
      this._wsState = WebSocketState.OPEN;
    };
    this._ws.onmessage = (event) => {
      try {
        this._receivedFrameCount = parseInt(event.data);
        this._wsState = WebSocketState.OPEN;
        this._isRendering = true;
        this.setTick(this._generatedFrameCount / frameRate);
      } catch (e) {
        console.error(e);
      }
    };

    this._isRendering = true;

    scene.game.events.addListener('postrender', () => {
      if (this._isRendering) {
        scene.renderer.snapshot((param) => {
          const rgbaBuffer = param as Uint8Array<ArrayBuffer>;
          const buffer = new Uint8Array((rgbaBuffer.length / 4) * 3);

          for (let i = 0, j = 0; i < rgbaBuffer.length; i += 4, j += 3) {
            buffer[j] = rgbaBuffer[i];
            buffer[j + 1] = rgbaBuffer[i + 1];
            buffer[j + 2] = rgbaBuffer[i + 2];
          }

          this._frameQueue.push(buffer);
          this.sendFrame();
        }, 'raw');
        this.setTick(++this._generatedFrameCount / frameRate);
      }
    });

    EventBus.on('render-stop', async () => {
      this.stopRendering();
    });

    getAllWindows().then((windows) => {
      windows.forEach((window) => {
        window.onCloseRequested(() => {
          this.stopRendering();
        });
      });
    });
  }

  setTick(progress: number) {
    requestAnimationFrame(() => {
      this._scene.game.loop.step(this._started + progress * 1000);
      this._scene.clock.setTime(progress - 1);
    });
  }

  async sendFrame() {
    if (this._isSendingFrame || this._frameQueue.length === 0) return;
    console.log(
      `QUEUED: ${this._frameQueue.length}, SENT: ${this._sentFrameCount}, RECEIVED: ${this._receivedFrameCount}`,
    );
    if (this._wsState === WebSocketState.PAUSED) {
      setTimeout(() => this.sendFrame(), 1000);
      return;
    }
    this._isSendingFrame = true;

    const frame = this._frameQueue.shift()!;
    if (frame === false) {
      this._ws.send('finish');
      this._ws.close();
      this._isSendingFrame = false;
      this._wsState = WebSocketState.CLOSED;
      return;
    }

    if (this._sentFrameCount - this._receivedFrameCount >= FRAME_BATCH_SIZE) {
      this._ws.send('pause');
      this._isRendering = false;
      this._isSendingFrame = false;
      this._wsState = WebSocketState.PAUSED;
      return;
    }

    if (this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(frame);
      this._sentFrameCount++;
    }

    this._isSendingFrame = false;
    this.sendFrame();
  }

  stopRendering() {
    if (this._isRendering) {
      this._isRendering = false;
      this._frameQueue.push(false);
      this.sendFrame();
    }
  }
}
