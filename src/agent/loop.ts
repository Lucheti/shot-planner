import type Anthropic from '@anthropic-ai/sdk';
import type { Storyboard } from '../domain/storyboard.js';
import type { AgentEvent, ChatMessage, FinishReason } from '../protocol/messages.js';
import type { MessagesClient, ModelMessage } from './anthropic-port.js';
import { buildSystemPrompt } from './system-prompt.js';
import type { ConversationTrimmer } from './token-budget.js';
import type { ToolRegistry, ToolRunner } from './tool-runner.js';

type MessageParam = Anthropic.Messages.MessageParam;
type ToolResultBlock = Anthropic.Messages.ToolResultBlockParam;
type ToolUseBlock = Anthropic.Messages.ToolUseBlock;

export interface AgentConfig {
  readonly model: string;
  readonly maxSteps: number;
  readonly maxOutputTokens: number;
}

export interface AgentDependencies {
  readonly client: MessagesClient;
  readonly registry: ToolRegistry;
  readonly runner: ToolRunner;
  readonly trimmer: ConversationTrimmer;
}

export interface AgentRequest {
  readonly messages: readonly ChatMessage[];
  readonly board: Storyboard;
}

/** Anything that can answer a chat turn with a stream of events: the Claude loop or the demo planner. */
export interface AgentRunner {
  run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

const FINISH_REASONS: Readonly<Record<string, FinishReason>> = {
  max_tokens: 'max_tokens',
  refusal: 'refusal',
};

/**
 * The agent loop. Each step streams one model response; if the model called tools, they are
 * applied to the board through the reducer, their results are fed back (errors flagged with
 * `is_error`), and the next step begins. Ends when the model stops calling tools, when the
 * step limit is reached, or when `signal` aborts.
 */
export async function* runAgent(
  config: AgentConfig,
  deps: AgentDependencies,
  request: AgentRequest,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const conversation: MessageParam[] = deps.trimmer.trim(request.messages).map((m) => ({ role: m.role, content: m.content }));
  const tools = deps.registry.list().map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.inputSchema(),
  }));
  let board = request.board;

  for (let step = 0; step < config.maxSteps; step += 1) {
    if (signal.aborted) {
      yield { type: 'finished', reason: 'cancelled' };
      return;
    }

    let message: ModelMessage;
    try {
      const stream = deps.client.messages.stream(
        {
          model: config.model,
          max_tokens: config.maxOutputTokens,
          system: buildSystemPrompt(board),
          tools,
          messages: conversation,
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }
      message = await stream.finalMessage();
    } catch (error) {
      yield signal.aborted
        ? { type: 'finished', reason: 'cancelled' }
        : { type: 'failed', message: describeError(error) };
      return;
    }

    const toolUses = message.content.filter((block): block is ToolUseBlock => block.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
      yield { type: 'finished', reason: FINISH_REASONS[message.stop_reason ?? ''] ?? 'end_turn' };
      return;
    }

    conversation.push({ role: 'assistant', content: message.content });
    const results: ToolResultBlock[] = [];
    for (const use of toolUses) {
      yield { type: 'tool_started', callId: use.id, tool: use.name };
      const outcome = deps.runner.run(use.name, use.input, board);
      yield { type: 'tool_finished', callId: use.id, tool: use.name, ok: outcome.ok, summary: outcome.summary };
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: outcome.modelMessage,
        ...(outcome.ok ? {} : { is_error: true }),
      });
      if (outcome.ok) {
        board = outcome.board;
        yield { type: 'board', board };
        if (outcome.generation) yield { type: 'generation_requested', ...outcome.generation };
      }
    }
    conversation.push({ role: 'user', content: results });
  }

  yield { type: 'finished', reason: 'step_limit' };
}

/** Wraps the loop as an `AgentRunner` so it can be swapped for the demo planner. */
export class ClaudeAgentRunner implements AgentRunner {
  constructor(
    private readonly config: AgentConfig,
    private readonly deps: AgentDependencies,
  ) {}

  public run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    return runAgent(this.config, this.deps, request, signal);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'The model request failed.';
}
