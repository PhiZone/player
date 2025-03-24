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
  private _isSendingFrame: boolean = false;
  private _receivedFrameCount: number = 0;
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
        this._receivedFrameCount = parseInt(event.data);
        this._wsState = WebSocketState.OPEN;
        this.dispatch(true);
      } catch (e) {
        console.error(e);
      }
    };

    self.onmessage = (event) => {
      const { data } = event.data;
      this._frameQueue.push(data);
      this.sendFrame();
    };
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

    if (this._sentFrameCount - this._receivedFrameCount >= FRAME_BATCH_SIZE) {
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
  }
}

new FrameSender();
