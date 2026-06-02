export class ConcurrencyLimiter {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(public readonly limit: number) {
    if (limit <= 0 && limit !== Infinity) {
      throw new Error("Concurrency limit must be a positive integer.");
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.limit === Infinity) {
      return fn();
    }
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.activeCount++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    this.activeCount--;
    const next = this.queue.shift();
    if (next) {
      this.activeCount++;
      next();
    }
  }
}

export function createLimiter(limit?: number): ConcurrencyLimiter {
  return new ConcurrencyLimiter(limit !== undefined && limit > 0 ? limit : Infinity);
}
