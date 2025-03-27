enum WebSocketState {
  OPEN = 1,
  PAUSED = 2,
  CLOSED = 3,
}

const WEBSOCKET_URL = 'ws://localhost:63401';
const FRAME_BATCH_SIZE = 500;

class FrameSender {
  private _ws: WebSocket;
  private _wsState: WebSocketState = WebSocketState.CLOSED;
  private _frameQueue: (Uint8Array<ArrayBuffer> | false)[] = [];
  private _sharedView: Uint8Array;
  private _intermediateBuffer: Array<number>;
  private _queuedBuffer: Uint8Array<ArrayBuffer>;
  private _currentStep: number = 0;
  private _blendSteps: number;
  private _isSendingFrame: boolean = false;
  private _renderedFrameCount: number = 0;
  private _encodedFrameCount: number = 0;
  private _sentFrameCount: number = 0;

  constructor() {
    this._ws = new WebSocket(WEBSOCKET_URL);
    this._ws.binaryType = 'arraybuffer';
    this._ws.onopen = () => {
      this._wsState = WebSocketState.OPEN;
    };
    this._ws.onmessage = (event: { data: string }) => {
      if (event.data === 'finished') {
        this.dispatch(false, true);
        this._ws.close();
        return;
      }
      try {
        this._encodedFrameCount = parseInt(event.data);
        this._wsState = WebSocketState.OPEN;
        this.dispatch(true);
      } catch (e) {
        console.error(e);
      }
    };

    self.onmessage = (event) => {
      const { type, buffer, frameNumber, blendSteps } = event.data;

      if (type === 'init') {
        this._sharedView = new Uint8Array(buffer);
        this._intermediateBuffer = new Array((this._sharedView.length / 4) * 3);
        this._queuedBuffer = new Uint8Array(new ArrayBuffer((this._sharedView.length / 4) * 3));
        this._blendSteps = blendSteps;
        return;
      }

      if (type === 'stop') {
        this._frameQueue.push(false);
        this.sendFrame();
        this.sendFrame();
        return;
      }

      if (type === 'frame') {
        this._renderedFrameCount = frameNumber;
        const frame = new Uint8Array(new ArrayBuffer(this._sharedView.length));
        frame.set(this._sharedView);
        this.processFrame(frame);
      }
    };
  }

  processFrame(frame: Uint8Array<ArrayBuffer>) {
    console.log(
      this._currentStep,
      this._renderedFrameCount,
      this._frameQueue.length,
      this._sentFrameCount,
      this._encodedFrameCount,
    );

    for (let i = 0, j = 0; i < frame.length; i += 4, j += 3) {
      if (this._currentStep === 0) {
        this._intermediateBuffer[j] = 0;
        this._intermediateBuffer[j + 1] = 0;
        this._intermediateBuffer[j + 2] = 0;
      }

      this._intermediateBuffer[j] += frame[i];
      this._intermediateBuffer[j + 1] += frame[i + 1];
      this._intermediateBuffer[j + 2] += frame[i + 2];

      if (this._currentStep === this._blendSteps - 1) {
        this._queuedBuffer[j] = this._intermediateBuffer[j] / this._blendSteps;
        this._queuedBuffer[j + 1] = this._intermediateBuffer[j + 1] / this._blendSteps;
        this._queuedBuffer[j + 2] = this._intermediateBuffer[j + 2] / this._blendSteps;
      }
    }

    if (++this._currentStep === this._blendSteps) {
      this._frameQueue.push(this._queuedBuffer);
      this.sendFrame();
      this._currentStep = 0;
    }
  }

  async sendFrame() {
    if (
      this._isSendingFrame ||
      this._frameQueue.length === 0 ||
      this._wsState === WebSocketState.CLOSED
    )
      return;

    if (this._wsState === WebSocketState.PAUSED) {
      setTimeout(() => this.sendFrame(), 100);
      return;
    }

    if (this._sentFrameCount - this._encodedFrameCount >= FRAME_BATCH_SIZE) {
      this._ws.send('pause');
      this._wsState = WebSocketState.PAUSED;
      this.dispatch(false);
      return;
    }

    this._isSendingFrame = true;

    const frame = this._frameQueue.shift()!;
    if (frame === false) {
      this._ws.send('finish');
      this._wsState = WebSocketState.CLOSED;
      this._isSendingFrame = false;
      return;
    }

    this._ws.send(frame);
    this._sentFrameCount++;

    this._isSendingFrame = false;

    this.sendFrame();
  }

  dispatch(proceed: boolean, finished: boolean = false) {
    self.postMessage({
      proceed,
      finished,
      encoded: this._encodedFrameCount,
    });
  }
}

new FrameSender();
