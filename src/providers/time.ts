/** Wall-clock time, injectable so providers are deterministic under test. */
export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }
}

/** Waiting, injectable so polling loops run instantly under test. */
export interface Sleeper {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export class SystemSleeper implements Sleeper {
  public sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Aborted'));
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
