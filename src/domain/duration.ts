import type { ToolError } from './errors.js';
import { err, ok, type Result } from './result.js';

/** A shot length: a whole number of seconds from 1 to 10. */
export class Duration {
  public static readonly MIN_SECONDS = 1;
  public static readonly MAX_SECONDS = 10;

  private constructor(private readonly value: number) {}

  /** Validates and wraps a number of seconds. */
  public static of(seconds: number): Result<Duration, Extract<ToolError, { code: 'INVALID_DURATION' }>> {
    const valid =
      Number.isInteger(seconds) && seconds >= Duration.MIN_SECONDS && seconds <= Duration.MAX_SECONDS;
    return valid ? ok(new Duration(seconds)) : err({ code: 'INVALID_DURATION', seconds });
  }

  /** The length in whole seconds. */
  public get seconds(): number {
    return this.value;
  }

  /** A new duration scaled by `factor`, rounded and clamped into the legal range. */
  public scaledBy(factor: number): Duration {
    const raw = Math.round(this.value * factor);
    return new Duration(Math.min(Duration.MAX_SECONDS, Math.max(Duration.MIN_SECONDS, raw)));
  }
}
