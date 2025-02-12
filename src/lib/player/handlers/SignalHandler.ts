export class SignalHandler {
  private resolve!: () => void;
  private promise: Promise<void>;
  private count: number;

  constructor(count: number) {
    this.count = count;
    this.reset();
  }

  wait(): Promise<void> {
    return this.promise;
  }

  emit(): void {
    this.count -= 1;
    if (this.count <= 0 && this.resolve) {
      this.resolve();
    }
  }

  private reset(): void {
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
}
