export class Mutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const prev = this.queue;
    this.queue = this.queue.then(() => next);

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
