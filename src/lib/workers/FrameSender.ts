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
  private _isSendingFrame: boolean = false;
  private _renderedFrameCount: number = 0;
  private _processedFrameCount: number = 0;
  private _sentFrameCount: number = 0;
  private _timeout: NodeJS.Timeout | null = null;

  constructor() {
    this._ws = new WebSocket(WEBSOCKET_URL);
    console.log('[FrameSender] Initializing WebSocket connection');
    this._ws.binaryType = 'arraybuffer';
    this._ws.onopen = () => {
      this._wsState = WebSocketState.OPEN;
      console.log('[FrameSender] WebSocket connection established');
    };
    this._ws.onmessage = (event: { data: string }) => {
      if (event.data === 'finished') {
        this.dispatch(false, true);
        this._ws.close();
        console.log('[FrameSender] WebSocket connection closed');
        return;
      }
      try {
        this._processedFrameCount = parseInt(event.data);
        this._wsState = WebSocketState.OPEN;
        this.dispatch(true);
      } catch (e) {
        console.error(e);
      }
    };

    self.onmessage = (event) => {
      const { type, buffer, frameNumber } = event.data;

      if (type === 'init') {
        this._sharedView = new Uint8Array(buffer);
        console.log('[FrameSender] Shared view initialized');
        return;
      }

      if (type === 'stop') {
        this._frameQueue.push(false);
        console.log('[FrameSender] Received stop signal');
        this.sendFrame();
        return;
      }

      if (type === 'frame') {
        this._renderedFrameCount = frameNumber;
        this.processFrame();
      }
    };
  }

  processFrame() {
    const frame = new Uint8Array(new ArrayBuffer(this._sharedView.length));
    frame.set(this._sharedView);
    this._frameQueue.push(frame);
    if (this._wsState === WebSocketState.OPEN) {
      this.dispatch(true);
      this.sendFrame();
    } else {
      console.log(`[FrameSender] New frame queued: ${this._renderedFrameCount}`);
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
      if (!this._timeout) {
        this._timeout = setTimeout(() => {
          this._timeout = null;
          this.sendFrame();
        }, 100);
      }
      return;
    }

    if (this._sentFrameCount - this._processedFrameCount >= FRAME_BATCH_SIZE) {
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
    });
    console.log(
      `[FrameSender] Command dispatched: proceed=${proceed}, finished=${finished}, rendered=${this._renderedFrameCount}, processed=${this._processedFrameCount}, sent=${this._sentFrameCount}`,
    );
  }
}

new FrameSender();
