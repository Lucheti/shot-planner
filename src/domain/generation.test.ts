import { describe, expect, it } from 'vitest';
import { boardWithShots } from './fixtures.js';
import { applyGenerationEvent, mergeAgentBoard } from './generation.js';
import { applyToolCall } from './reducer.js';

describe('applyGenerationEvent', () => {
  it('records progress on the shot', () => {
    const next = applyGenerationEvent(boardWithShots(2), {
      type: 'generation_state',
      shotId: 'shot_2',
      generation: { status: 'generating', mode: 'image', stage: 'keyframe', progress: 0.4 },
    });
    expect(next.shots[1]?.generation).toEqual({ status: 'generating', mode: 'image', stage: 'keyframe', progress: 0.4 });
    expect(next.shots[0]?.generation.status).toBe('idle');
  });

  it('stores a keyframe and drops a stale clip', () => {
    let board = boardWithShots(1);
    board = applyGenerationEvent(board, { type: 'clip_ready', shotId: 'shot_1', clip: { url: '/c.mp4', mimeType: 'video/mp4' } });
    expect(board.shots[0]?.clip?.url).toBe('/c.mp4');
    board = applyGenerationEvent(board, { type: 'keyframe_ready', shotId: 'shot_1', url: '/k.png' });
    expect(board.shots[0]).toMatchObject({ keyframeUrl: '/k.png', clip: null });
  });

  it('ignores events for shots that were removed', () => {
    const board = boardWithShots(1);
    expect(applyGenerationEvent(board, { type: 'keyframe_ready', shotId: 'gone', url: '/k.png' })).toBe(board);
  });
});

describe('mergeAgentBoard', () => {
  it('keeps local generation state and media while taking the agent plan', () => {
    let local = boardWithShots(2);
    local = applyGenerationEvent(local, { type: 'keyframe_ready', shotId: 'shot_1', url: '/k1.png' });
    local = applyGenerationEvent(local, {
      type: 'generation_state',
      shotId: 'shot_1',
      generation: { status: 'done', mode: 'image' },
    });
    const edited = applyToolCall(boardWithShots(2), {
      tool: 'update_shot',
      shotId: 'shot_1',
      patch: { framing: 'close-up' },
    });
    if (!edited.ok) throw new Error('fixture');

    const merged = mergeAgentBoard(local, edited.value);
    expect(merged.shots[0]).toMatchObject({
      framing: 'close-up',
      keyframeUrl: '/k1.png',
      generation: { status: 'done', mode: 'image' },
    });
  });

  it('adopts new shots as-is and drops removed ones', () => {
    const local = boardWithShots(2);
    const incoming = applyToolCall(local, { tool: 'remove_shot', shotId: 'shot_1' });
    if (!incoming.ok) throw new Error('fixture');
    expect(mergeAgentBoard(local, incoming.value).shots.map((s) => s.id)).toEqual(['shot_2']);
  });
});
