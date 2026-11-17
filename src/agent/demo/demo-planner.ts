import type { AgentEvent } from '../../protocol/messages.js';
import type { Sleeper } from '../../providers/time.js';
import type { AgentRequest, AgentRunner } from '../loop.js';
import type { ToolRunner } from '../tool-runner.js';
import type { Beat, DemoContext, DemoIntent } from './intents.js';

/**
 * The offline stand-in for the Claude agent. It speaks the same event protocol and applies its
 * tool calls through the same `ToolRunner` and reducer, so the UI exercises the real code path.
 */
export class DemoPlanner implements AgentRunner {
  constructor(
    private readonly intents: readonly DemoIntent[],
    private readonly runner: ToolRunner,
    private readonly sleeper: Sleeper,
    private readonly wordDelayMs = 28,
  ) {}

  public async *run(request: AgentRequest, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    const userMessages = request.messages.filter((m) => m.role === 'user');
    const context: DemoContext = {
      firstUser: userMessages[0]?.content ?? '',
      lastUser: userMessages.at(-1)?.content ?? '',
      userTurns: userMessages.length,
      board: request.board,
    };
    const intent = this.intents.find((candidate) => candidate.matches(context));
    const beats = intent?.plan(context) ?? [];

    let board = request.board;
    let callNumber = 0;
    try {
      for (const beat of beats) {
        if (signal.aborted) break;
        if (beat.kind === 'say') {
          yield* this.speak(beat, signal);
          continue;
        }
        callNumber += 1;
        const callId = `demo_${callNumber}`;
        yield { type: 'tool_started', callId, tool: beat.name };
        await this.sleeper.sleep(this.wordDelayMs * 8, signal);
        const outcome = this.runner.run(beat.name, beat.input, board);
        yield { type: 'tool_finished', callId, tool: beat.name, ok: outcome.ok, summary: outcome.summary };
        if (outcome.ok) {
          board = outcome.board;
          yield { type: 'board', board };
          if (outcome.generation) yield { type: 'generation_requested', ...outcome.generation };
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
    yield { type: 'finished', reason: signal.aborted ? 'cancelled' : 'end_turn' };
  }

  private async *speak(beat: Extract<Beat, { kind: 'say' }>, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    for (const word of beat.text.match(/\S+\s*/g) ?? []) {
      await this.sleeper.sleep(this.wordDelayMs, signal);
      yield { type: 'text_delta', text: word };
    }
    yield { type: 'text_delta', text: '\n\n' };
  }
}
