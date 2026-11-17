import type { z } from 'zod';
import {
  agentEventSchema,
  generateStreamMessageSchema,
  type AgentEvent,
  type AppInfo,
  type ChatRequest,
  type GenerateRequest,
  type GenerateStreamMessage,
} from '../../protocol/messages.js';
import { SseParser } from '../../protocol/sse.js';

/** The web app's only door to the server. Swappable for tests. */
export interface ApiClient {
  info(): Promise<AppInfo>;
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
  generate(request: GenerateRequest, signal: AbortSignal): AsyncIterable<GenerateStreamMessage>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Decodes a streaming SSE response into validated messages. */
export async function* readSseMessages<T>(response: Response, schema: z.ZodType<T>): AsyncGenerator<T> {
  if (!response.ok) {
    const detail = await response.json().then((body: { error?: string }) => body.error, () => undefined);
    throw new Error(detail ?? `Request failed with status ${response.status}.`);
  }
  if (!response.body) throw new Error('The server sent no stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        const parsed = schema.safeParse(JSON.parse(frame.data));
        if (parsed.success) yield parsed.data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** `ApiClient` over `fetch` and server-sent events. */
export class HttpApiClient implements ApiClient {
  constructor(
    private readonly fetchFn: FetchLike,
    private readonly baseUrl = '',
  ) {}

  public async info(): Promise<AppInfo> {
    const response = await this.fetchFn(`${this.baseUrl}/api/info`);
    if (!response.ok) throw new Error(`Could not reach the server (status ${response.status}).`);
    return (await response.json()) as AppInfo;
  }

  public chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    return this.stream('/api/chat', request, agentEventSchema, signal);
  }

  public generate(request: GenerateRequest, signal: AbortSignal): AsyncIterable<GenerateStreamMessage> {
    return this.stream('/api/generate', request, generateStreamMessageSchema, signal);
  }

  private async *stream<T>(path: string, body: unknown, schema: z.ZodType<T>, signal: AbortSignal): AsyncGenerator<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    yield* readSseMessages(response, schema);
  }
}
