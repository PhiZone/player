export class Signal {
  private _resolve!: () => void;
  private _promise: Promise<void>;
  private _targetCount: number;
  private _currentCount: number;

  constructor(count: number) {
    this._targetCount = count;
    this.reset();
  }

  wait(): Promise<void> {
    return this._promise;
  }

  emit(): void {
    this._currentCount -= 1;
    if (this._currentCount <= 0 && this._resolve) {
      this._currentCount = 0;
      this._resolve();
    }
  }

  reset(): void {
    this._currentCount = this._targetCount;
    this._promise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }
}
