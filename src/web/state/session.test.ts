import { describe, expect, it } from 'vitest';
import { applyGenerationEvent } from '../../domain/generation.js';
import { boardWithShots } from '../../domain/fixtures.js';
import { emptyStoryboard } from '../../domain/storyboard.js';
import type { AgentEvent } from '../../protocol/messages.js';
import { applyAgentEvent, assistantText, type Session, type TranscriptEntry } from './session.js';

const assistant: TranscriptEntry = { id: 'a1', role: 'assistant', parts: [], done: false };
const base: Session = {
  info: null,
  board: emptyStoryboard(),
  transcript: [{ id: 'u1', role: 'user', text: 'hi' }, assistant],
  chatRunning: true,
  error: null,
};

const fold = (events: AgentEvent[], start: Session = base) => events.reduce(applyAgentEvent, start);
const lastAssistant = (session: Session) => {
  const entry = session.transcript.at(-1);
  if (entry?.role !== 'assistant') throw new Error('expected assistant entry');
  return entry;
};

describe('applyAgentEvent', () => {
  it('accumulates streamed text into one part', () => {
    const next = fold([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
    ]);
    expect(lastAssistant(next).parts).toEqual([{ kind: 'text', text: 'Hello' }]);
  });

  it('interleaves text and tool actions in arrival order', () => {
    const next = fold([
      { type: 'text_delta', text: 'Drafting.' },
      { type: 'tool_started', callId: 'c1', tool: 'create_storyboard' },
      { type: 'tool_finished', callId: 'c1', tool: 'create_storyboard', ok: true, summary: 'Created "X"' },
      { type: 'text_delta', text: 'Done.' },
    ]);
    expect(lastAssistant(next).parts).toEqual([
      { kind: 'text', text: 'Drafting.' },
      { kind: 'action', callId: 'c1', tool: 'create_storyboard', status: 'ok', summary: 'Created "X"' },
      { kind: 'text', text: 'Done.' },
    ]);
  });

  it('marks a failed tool as an error action', () => {
    const next = fold([
      { type: 'tool_started', callId: 'c1', tool: 'update_shot' },
      { type: 'tool_finished', callId: 'c1', tool: 'update_shot', ok: false, summary: 'Could not apply' },
    ]);
    expect(lastAssistant(next).parts[0]).toMatchObject({ status: 'error', summary: 'Could not apply' });
  });

  it('only touches the latest assistant entry', () => {
    const first: TranscriptEntry = { id: 'a0', role: 'assistant', parts: [{ kind: 'text', text: 'old' }], done: true };
    const next = fold([{ type: 'text_delta', text: 'new' }], { ...base, transcript: [first, ...base.transcript] });
    expect(next.transcript[0]).toBe(first);
  });

  it('merges board snapshots without losing local renders', () => {
    const local = applyGenerationEvent(boardWithShots(2), { type: 'keyframe_ready', shotId: 'shot_1', url: '/k.svg' });
    const incoming = boardWithShots(2);
    const next = fold([{ type: 'board', board: incoming }], { ...base, board: local });
    expect(next.board.shots[0]?.keyframeUrl).toBe('/k.svg');
  });

  it('adds a notice when a turn ends for a reason other than completion', () => {
    expect(lastAssistant(fold([{ type: 'finished', reason: 'end_turn' }])).parts).toEqual([]);
    expect(lastAssistant(fold([{ type: 'finished', reason: 'cancelled' }])).parts).toEqual([{ kind: 'notice', text: 'Stopped.' }]);
    expect(lastAssistant(fold([{ type: 'finished', reason: 'step_limit' }])).done).toBe(true);
  });

  it('records a failure and closes the message', () => {
    const next = fold([{ type: 'failed', message: 'boom' }]);
    expect(next.error).toBe('boom');
    expect(lastAssistant(next).done).toBe(true);
  });

  it('leaves the session alone for generation requests (the store handles them)', () => {
    expect(fold([{ type: 'generation_requested', shotId: 's', mode: 'image' }])).toBe(base);
  });
});

describe('assistantText', () => {
  it('joins only the prose parts', () => {
    expect(
      assistantText({
        id: 'a',
        role: 'assistant',
        done: true,
        parts: [
          { kind: 'text', text: 'One. ' },
          { kind: 'action', callId: 'c', tool: 't', status: 'ok', summary: 's' },
          { kind: 'text', text: 'Two.' },
        ],
      }),
    ).toBe('One. Two.');
  });
});
