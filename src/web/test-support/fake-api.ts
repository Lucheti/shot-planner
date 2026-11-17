import type { AgentEvent, AppInfo, ChatRequest, GenerateRequest, GenerateStreamMessage } from '../../protocol/messages.js';
import type { ApiClient } from '../api/api-client.js';

type Script<T, R> = (request: R, signal: AbortSignal) => AsyncIterable<T> | Iterable<T>;

/** Test double for the server: scripts are plain functions returning events. */
export class FakeApi implements ApiClient {
  public readonly chatRequests: ChatRequest[] = [];
  public readonly generateRequests: GenerateRequest[] = [];

  constructor(
    private readonly scripts: {
      info?: AppInfo;
      chat?: Script<AgentEvent, ChatRequest>;
      generate?: Script<GenerateStreamMessage, GenerateRequest>;
    } = {},
  ) {}

  public info(): Promise<AppInfo> {
    return Promise.resolve(this.scripts.info ?? { planner: 'mock', providers: 'mock', model: null });
  }

  public async *chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    this.chatRequests.push(structuredClone(request));
    yield* this.scripts.chat?.(request, signal) ?? [];
  }

  public async *generate(request: GenerateRequest, signal: AbortSignal): AsyncGenerator<GenerateStreamMessage> {
    this.generateRequests.push(structuredClone(request));
    yield* this.scripts.generate?.(request, signal) ?? [];
  }
}

/** A promise you resolve by hand, to hold a scripted stream open. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Resolves when `signal` aborts. */
export function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
