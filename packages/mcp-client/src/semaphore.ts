import type { ConsoleErrorCode } from '@mymcp/console-contracts';

export class CapacityError extends Error {
  readonly code: ConsoleErrorCode = 'TOO_MANY_REQUESTS';

  constructor(message: string) {
    super(message);
    this.name = 'CapacityError';
  }
}

interface Waiter {
  resolve: (release: () => void) => void;
}

export class Semaphore {
  readonly #limit: number;
  readonly #queueLimit: number;
  readonly #waiters: Waiter[] = [];
  #active = 0;

  constructor(limit: number, queueLimit: number) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(queueLimit) ||
      queueLimit < 0
    ) {
      throw new TypeError('Semaphore limits must be non-negative safe integers');
    }
    this.#limit = limit;
    this.#queueLimit = queueLimit;
  }

  acquire(): Promise<() => void> {
    if (this.#active < this.#limit) {
      this.#active += 1;
      return Promise.resolve(this.#releaseOnce());
    }
    if (this.#waiters.length >= this.#queueLimit) {
      return Promise.reject(new CapacityError('MCP call queue is full'));
    }
    return new Promise((resolve) => this.#waiters.push({ resolve }));
  }

  #releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.#waiters.shift();
      if (waiter) {
        waiter.resolve(this.#releaseOnce());
      } else {
        this.#active -= 1;
      }
    };
  }
}
