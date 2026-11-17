import { describe, expect, it } from 'vitest';
import { Duration } from './duration.js';

describe('Duration', () => {
  it.each([1, 5, 10])('accepts %i seconds', (seconds) => {
    const result = Duration.of(seconds);
    expect(result.ok && result.value.seconds).toBe(seconds);
  });

  it.each([0, 11, -3, 2.5, Number.NaN, Infinity])('rejects %s', (seconds) => {
    const result = Duration.of(seconds);
    expect(result.ok).toBe(false);
  });

  it('scales and clamps into the legal range', () => {
    const six = Duration.of(6);
    if (!six.ok) throw new Error('fixture');
    expect(six.value.scaledBy(0.5).seconds).toBe(3);
    expect(six.value.scaledBy(0.01).seconds).toBe(Duration.MIN_SECONDS);
    expect(six.value.scaledBy(100).seconds).toBe(Duration.MAX_SECONDS);
  });
});
