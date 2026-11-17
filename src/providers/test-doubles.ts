import type { Clock, Sleeper } from './time.js';

/** Test double: sleeping resolves immediately and advances the shared manual clock. */
export class InstantSleeper implements Sleeper {
  public readonly sleeps: number[] = [];

  constructor(private readonly clock?: ManualClock) {}

  public sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error('Aborted'));
    this.sleeps.push(ms);
    this.clock?.advance(ms);
    return Promise.resolve();
  }
}

/** Test double: time moves only when told to. */
export class ManualClock implements Clock {
  private current = 0;

  public now(): number {
    return this.current;
  }

  public advance(ms: number): void {
    this.current += ms;
  }
}
