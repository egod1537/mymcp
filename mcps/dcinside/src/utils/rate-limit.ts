interface QueueItem<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class RateLimiter {
  private readonly queue: QueueItem<unknown>[] = [];
  private active = 0;
  private nextStartAt = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly intervalMs: number,
    private readonly maxConcurrency: number,
  ) {
    if (intervalMs < 0 || maxConcurrency < 1) {
      throw new Error("Invalid rate limiter configuration");
    }
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject } as QueueItem<unknown>);
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer || this.active >= this.maxConcurrency || this.queue.length === 0) return;

    const delay = Math.max(0, this.nextStartAt - Date.now());
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, delay);
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.active += 1;
    this.nextStartAt = Date.now() + this.intervalMs;
    void item.task().then(item.resolve, item.reject).finally(() => {
      this.active -= 1;
      this.pump();
    });

    this.pump();
  }
}
