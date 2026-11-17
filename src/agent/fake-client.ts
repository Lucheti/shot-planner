import type { MessagesClient, ModelMessage, ModelStream, StreamEvent, StreamParams } from './anthropic-port.js';

export type ScriptedBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown };

export interface ScriptedTurn {
  readonly blocks: readonly ScriptedBlock[];
  /** Defaults to "tool_use" when the turn has a tool block, otherwise "end_turn". */
  readonly stopReason?: ModelMessage['stop_reason'];
}

/** Test double for the Anthropic client: replays scripted turns as real-shaped streaming events. */
export class FakeMessagesClient implements MessagesClient {
  private turnIndex = 0;
  private readonly recorded: StreamParams[] = [];

  constructor(private readonly turns: readonly ScriptedTurn[]) {}

  /** Snapshots of every request made, taken at call time. */
  public get requests(): readonly StreamParams[] {
    return this.recorded;
  }

  public readonly messages = {
    stream: (params: StreamParams, options?: { signal?: AbortSignal }): ModelStream => {
      this.recorded.push(structuredClone(params));
      const turn = this.turns[this.turnIndex];
      this.turnIndex += 1;
      if (!turn) throw new Error('FakeMessagesClient: script exhausted');
      return new FakeStream(turn, params.model, options?.signal);
    },
  };
}

class FakeStream implements ModelStream {
  constructor(
    private readonly turn: ScriptedTurn,
    private readonly model: string,
    private readonly signal: AbortSignal | undefined,
  ) {}

  public async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    for (const event of this.events()) {
      await Promise.resolve();
      this.throwIfAborted();
      yield event;
    }
  }

  public async finalMessage(): Promise<ModelMessage> {
    this.throwIfAborted();
    const hasTool = this.turn.blocks.some((block) => block.type === 'tool_use');
    return {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: this.model,
      content: this.turn.blocks.map((block) =>
        block.type === 'text'
          ? { type: 'text', text: block.text, citations: null }
          : { type: 'tool_use', id: block.id, name: block.name, input: block.input },
      ),
      stop_reason: this.turn.stopReason ?? (hasTool ? 'tool_use' : 'end_turn'),
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as ModelMessage;
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) throw new Error('Request was aborted.');
  }

  private *events(): Generator<StreamEvent> {
    let index = 0;
    for (const block of this.turn.blocks) {
      if (block.type === 'text') {
        yield { type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: null } } as StreamEvent;
        for (const text of block.text.match(/\S+\s*|\s+/g) ?? []) {
          yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } as StreamEvent;
        }
      } else {
        yield {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
        } as StreamEvent;
        yield {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
        } as StreamEvent;
      }
      yield { type: 'content_block_stop', index } as StreamEvent;
      index += 1;
    }
  }
}
