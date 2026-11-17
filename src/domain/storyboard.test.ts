import { describe, expect, it } from 'vitest';
import { describeToolError } from './errors.js';
import { boardWithShots } from './fixtures.js';
import { storyboardSchema } from './schema.js';
import { describeStoryboard, emptyStoryboard, findShot, isEmpty, shotNumber, totalSeconds } from './storyboard.js';

describe('storyboard queries', () => {
  it('reports emptiness, totals and shot numbers', () => {
    const board = boardWithShots(3);
    expect(isEmpty(emptyStoryboard())).toBe(true);
    expect(totalSeconds(board)).toBe(12);
    expect(shotNumber(board, 'shot_3')).toBe(3);
    expect(shotNumber(board, 'zzz')).toBeNull();
    expect(findShot(board, 'shot_2')?.id).toBe('shot_2');
  });

  it('describes the plan for the model without media urls', () => {
    const text = describeStoryboard(boardWithShots(2));
    expect(text).toContain('Storyboard "Ceramic studio teaser" (16:9, 8s total, 2 shots)');
    expect(text).toContain('#2 id=shot_2');
    expect(describeStoryboard(emptyStoryboard())).toBe('The storyboard is empty.');
  });
});

describe('storyboardSchema', () => {
  it('round-trips a reducer-built board through JSON', () => {
    const board = boardWithShots(3);
    expect(storyboardSchema.parse(JSON.parse(JSON.stringify(board)))).toEqual(board);
  });

  it('rejects a malformed board', () => {
    expect(storyboardSchema.safeParse({ title: 1 }).success).toBe(false);
  });
});

describe('describeToolError', () => {
  it('gives the model something to act on', () => {
    expect(describeToolError({ code: 'SHOT_NOT_FOUND', shotId: 'x', knownShotIds: ['a', 'b'] })).toContain('a, b');
    expect(describeToolError({ code: 'INVALID_DURATION', seconds: 12 })).toContain('got 12');
  });
});
