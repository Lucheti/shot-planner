import { describe, expect, it } from 'vitest';
import { boardWithShots, draft } from './fixtures.js';
import { applyToolCall } from './reducer.js';
import { emptyStoryboard, totalSeconds, type Storyboard } from './storyboard.js';
import type { ToolCall } from './tool-call.js';

function apply(board: Storyboard, call: ToolCall): Storyboard {
  const result = applyToolCall(board, call);
  if (!result.ok) throw new Error(`unexpected error: ${result.error.code}`);
  return result.value;
}

function failure(board: Storyboard, call: ToolCall) {
  const result = applyToolCall(board, call);
  if (result.ok) throw new Error('expected an error');
  return result.error;
}

describe('create_storyboard', () => {
  it('builds shots with sequential ids and idle generation', () => {
    const board = boardWithShots(3);
    expect(board.shots.map((s) => s.id)).toEqual(['shot_1', 'shot_2', 'shot_3']);
    expect(board.shots.every((s) => s.generation.status === 'idle' && s.keyframeUrl === null)).toBe(true);
    expect(board.nextShotSeq).toBe(4);
  });

  it('continues the id sequence when replacing an existing board', () => {
    const replaced = apply(boardWithShots(2), {
      tool: 'create_storyboard',
      title: 'Second take',
      aspectRatio: '9:16',
      shots: [draft()],
    });
    expect(replaced.shots.map((s) => s.id)).toEqual(['shot_3']);
    expect(replaced.aspectRatio).toBe('9:16');
    expect(replaced.title).toBe('Second take');
  });

  it('rejects an empty shot list', () => {
    const error = failure(emptyStoryboard(), { tool: 'create_storyboard', title: 't', aspectRatio: '16:9', shots: [] });
    expect(error.code).toBe('NO_SHOTS');
  });

  it('rejects more than the maximum number of shots', () => {
    const shots = Array.from({ length: 13 }, () => draft());
    expect(failure(emptyStoryboard(), { tool: 'create_storyboard', title: 't', aspectRatio: '16:9', shots }).code).toBe(
      'TOO_MANY_SHOTS',
    );
  });

  it('rejects a draft with an invalid duration and leaves the board untouched', () => {
    const before = boardWithShots(1);
    const error = failure(before, {
      tool: 'create_storyboard',
      title: 't',
      aspectRatio: '16:9',
      shots: [draft({ durationSeconds: 11 })],
    });
    expect(error).toEqual({ code: 'INVALID_DURATION', seconds: 11 });
  });
});

describe('update_shot', () => {
  it('merges the patch and keeps untouched fields and media', () => {
    const board = boardWithShots(2);
    const next = apply(board, { tool: 'update_shot', shotId: 'shot_2', patch: { framing: 'close-up' } });
    expect(next.shots[1]?.framing).toBe('close-up');
    expect(next.shots[1]?.description).toBe(board.shots[1]?.description);
    expect(next.shots[0]).toBe(board.shots[0]);
  });

  it('does not mutate the input board', () => {
    const board = boardWithShots(2);
    const snapshot = JSON.stringify(board);
    apply(board, { tool: 'update_shot', shotId: 'shot_1', patch: { durationSeconds: 2 } });
    expect(JSON.stringify(board)).toBe(snapshot);
  });

  it('reports unknown shots with the known ids', () => {
    const error = failure(boardWithShots(2), { tool: 'update_shot', shotId: 'shot_9', patch: { framing: 'wide' } });
    expect(error).toEqual({ code: 'SHOT_NOT_FOUND', shotId: 'shot_9', knownShotIds: ['shot_1', 'shot_2'] });
  });

  it('rejects an empty patch, including one with only undefined fields', () => {
    expect(failure(boardWithShots(1), { tool: 'update_shot', shotId: 'shot_1', patch: {} }).code).toBe('EMPTY_PATCH');
    expect(
      failure(boardWithShots(1), { tool: 'update_shot', shotId: 'shot_1', patch: { framing: undefined } }).code,
    ).toBe('EMPTY_PATCH');
  });

  it('rejects durations outside 1-10 seconds', () => {
    const board = boardWithShots(1);
    expect(failure(board, { tool: 'update_shot', shotId: 'shot_1', patch: { durationSeconds: 0 } }).code).toBe(
      'INVALID_DURATION',
    );
    expect(failure(board, { tool: 'update_shot', shotId: 'shot_1', patch: { durationSeconds: 2.5 } }).code).toBe(
      'INVALID_DURATION',
    );
  });

  it('requires a storyboard', () => {
    expect(failure(emptyStoryboard(), { tool: 'update_shot', shotId: 'shot_1', patch: { framing: 'wide' } }).code).toBe(
      'NO_STORYBOARD',
    );
  });
});

describe('add_shot', () => {
  it('appends when no anchor is given', () => {
    const next = apply(boardWithShots(2), { tool: 'add_shot', afterShotId: null, shot: draft({ description: 'Logo' }) });
    expect(next.shots.map((s) => s.id)).toEqual(['shot_1', 'shot_2', 'shot_3']);
    expect(next.shots[2]?.description).toBe('Logo');
  });

  it('inserts after the anchor shot', () => {
    const next = apply(boardWithShots(3), { tool: 'add_shot', afterShotId: 'shot_1', shot: draft() });
    expect(next.shots.map((s) => s.id)).toEqual(['shot_1', 'shot_4', 'shot_2', 'shot_3']);
  });

  it('never reuses the id of a removed shot', () => {
    const removed = apply(boardWithShots(2), { tool: 'remove_shot', shotId: 'shot_2' });
    const next = apply(removed, { tool: 'add_shot', afterShotId: null, shot: draft() });
    expect(next.shots.map((s) => s.id)).toEqual(['shot_1', 'shot_3']);
  });

  it('rejects an unknown anchor', () => {
    expect(failure(boardWithShots(1), { tool: 'add_shot', afterShotId: 'nope', shot: draft() }).code).toBe(
      'SHOT_NOT_FOUND',
    );
  });

  it('rejects a full board', () => {
    expect(failure(boardWithShots(12), { tool: 'add_shot', afterShotId: null, shot: draft() }).code).toBe(
      'TOO_MANY_SHOTS',
    );
  });

  it('rejects a bad duration and an empty board', () => {
    expect(
      failure(boardWithShots(1), { tool: 'add_shot', afterShotId: null, shot: draft({ durationSeconds: 99 }) }).code,
    ).toBe('INVALID_DURATION');
    expect(failure(emptyStoryboard(), { tool: 'add_shot', afterShotId: null, shot: draft() }).code).toBe(
      'NO_STORYBOARD',
    );
  });
});

describe('remove_shot', () => {
  it('removes the shot and renumbers by position', () => {
    const next = apply(boardWithShots(3), { tool: 'remove_shot', shotId: 'shot_2' });
    expect(next.shots.map((s) => s.id)).toEqual(['shot_1', 'shot_3']);
    expect(totalSeconds(next)).toBe(8);
  });

  it('reports unknown shots', () => {
    expect(failure(boardWithShots(1), { tool: 'remove_shot', shotId: 'x' }).code).toBe('SHOT_NOT_FOUND');
  });
});

describe('reorder_shots', () => {
  it('applies a valid permutation', () => {
    const next = apply(boardWithShots(3), { tool: 'reorder_shots', order: ['shot_3', 'shot_1', 'shot_2'] });
    expect(next.shots.map((s) => s.id)).toEqual(['shot_3', 'shot_1', 'shot_2']);
  });

  it.each([
    ['missing ids', ['shot_1', 'shot_2']],
    ['duplicates', ['shot_1', 'shot_1', 'shot_2']],
    ['unknown ids', ['shot_1', 'shot_2', 'shot_9']],
  ])('rejects %s', (_label, order) => {
    expect(failure(boardWithShots(3), { tool: 'reorder_shots', order }).code).toBe('INVALID_ORDER');
  });
});

describe('generate_shot', () => {
  it('validates the shot and leaves the board unchanged', () => {
    const board = boardWithShots(2);
    expect(apply(board, { tool: 'generate_shot', shotId: 'shot_1', mode: 'image' })).toBe(board);
  });

  it('rejects unknown shots', () => {
    expect(failure(boardWithShots(2), { tool: 'generate_shot', shotId: 'shot_7', mode: 'video' }).code).toBe(
      'SHOT_NOT_FOUND',
    );
  });
});
