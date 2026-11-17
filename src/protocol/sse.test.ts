import { describe, expect, it } from 'vitest';
import { boardWithShots } from '../domain/fixtures.js';
import { agentEventSchema, chatRequestSchema, generateStreamMessageSchema } from './messages.js';
import { encodeSse, SseParser } from './sse.js';

describe('SSE codec', () => {
  it('round-trips a message', () => {
    const message = { type: 'text_delta', text: 'hi' };
    const frames = new SseParser().push(encodeSse(message));
    expect(frames).toEqual([{ event: 'text_delta', data: '{"type":"text_delta","text":"hi"}' }]);
  });

  it('reassembles frames split across chunks and handles CRLF', () => {
    const parser = new SseParser();
    const wire = encodeSse({ type: 'a' }) + encodeSse({ type: 'b' });
    const cut = 9;
    expect(parser.push(wire.slice(0, cut))).toEqual([]);
    const frames = parser.push(wire.slice(cut).replace(/\n/g, '\r\n'));
    expect(frames.map((f) => f.event)).toEqual(['a', 'b']);
  });

  it('skips comments and frames without data', () => {
    expect(new SseParser().push(': keep-alive\n\nevent: x\n\n')).toEqual([]);
  });
});

describe('wire schemas', () => {
  it('accepts every agent event shape', () => {
    const events = [
      { type: 'text_delta', text: 'a' },
      { type: 'tool_started', callId: '1', tool: 'update_shot' },
      { type: 'tool_finished', callId: '1', tool: 'update_shot', ok: true, summary: 's' },
      { type: 'board', board: boardWithShots(1) },
      { type: 'generation_requested', shotId: 'shot_1', mode: 'image' },
      { type: 'finished', reason: 'end_turn' },
      { type: 'failed', message: 'x' },
    ];
    for (const event of events) expect(agentEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects unknown event types', () => {
    expect(agentEventSchema.safeParse({ type: 'nope' }).success).toBe(false);
    expect(generateStreamMessageSchema.safeParse({ type: 'keyframe_ready', shotId: 1 }).success).toBe(false);
  });

  it('requires the last chat message to come from the user', () => {
    const board = boardWithShots(1);
    expect(chatRequestSchema.safeParse({ messages: [{ role: 'assistant', content: 'x' }], board }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'x' }], board }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ messages: [], board }).success).toBe(false);
  });
});
