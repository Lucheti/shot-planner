import { describe, expect, it } from 'vitest';
import { boardWithShots } from '../../domain/fixtures.js';
import { agentEventSchema } from '../../protocol/messages.js';
import { encodeSse } from '../../protocol/sse.js';
import { HttpApiClient, readSseMessages, type FetchLike } from './api-client.js';

function streamingResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init });
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of stream) out.push(item);
  return out;
}

describe('readSseMessages', () => {
  it('decodes validated messages, even when frames and multi-byte characters straddle chunks', async () => {
    const wire = encodeSse({ type: 'text_delta', text: 'café ☕' }) + encodeSse({ type: 'finished', reason: 'end_turn' });
    const bytes = new TextEncoder().encode(wire);
    const split = wire.indexOf('☕') + 1;
    const cut = new TextEncoder().encode(wire.slice(0, split)).length;
    const chunks = [bytes.slice(0, cut), bytes.slice(cut)];
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          chunks.forEach((c) => controller.enqueue(c));
          controller.close();
        },
      }),
    );
    expect(await collect(readSseMessages(response, agentEventSchema))).toEqual([
      { type: 'text_delta', text: 'café ☕' },
      { type: 'finished', reason: 'end_turn' },
    ]);
  });

  it('drops frames that fail validation instead of crashing the stream', async () => {
    const response = streamingResponse([
      encodeSse({ type: 'mystery' }),
      encodeSse({ type: 'board', board: boardWithShots(1) }),
    ]);
    const messages = await collect(readSseMessages(response, agentEventSchema));
    expect(messages.map((m) => m.type)).toEqual(['board']);
  });

  it('throws the server error message for a non-2xx response', async () => {
    const response = new Response(JSON.stringify({ error: 'Invalid chat request.' }), { status: 400 });
    await expect(collect(readSseMessages(response, agentEventSchema))).rejects.toThrow('Invalid chat request.');
  });
});

describe('HttpApiClient', () => {
  it('posts JSON to the chat endpoint and streams the reply', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetchFn: FetchLike = (url, init) => {
      captured = { url, init };
      return Promise.resolve(streamingResponse([encodeSse({ type: 'finished', reason: 'end_turn' })]));
    };
    const client = new HttpApiClient(fetchFn, 'http://api.test');
    const events = await collect(
      client.chat({ messages: [{ role: 'user', content: 'hi' }], board: boardWithShots(1) }, new AbortController().signal),
    );
    expect(events).toEqual([{ type: 'finished', reason: 'end_turn' }]);
    expect(captured?.url).toBe('http://api.test/api/chat');
    expect(captured?.init?.method).toBe('POST');
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({ messages: [{ role: 'user', content: 'hi' }] });
  });

  it('reads the server info', async () => {
    const fetchFn: FetchLike = () =>
      Promise.resolve(new Response(JSON.stringify({ planner: 'claude', providers: 'runway', model: 'm' })));
    expect(await new HttpApiClient(fetchFn).info()).toEqual({ planner: 'claude', providers: 'runway', model: 'm' });
  });

  it('fails clearly when the server is unreachable', async () => {
    const fetchFn: FetchLike = () => Promise.resolve(new Response('', { status: 502 }));
    await expect(new HttpApiClient(fetchFn).info()).rejects.toThrow('status 502');
  });
});
