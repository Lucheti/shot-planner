import { describe, expect, it } from 'vitest';
import { boardWithShots, draft } from '../domain/fixtures.js';
import { emptyStoryboard } from '../domain/storyboard.js';
import type { AgentEvent } from '../protocol/messages.js';
import { FakeMessagesClient, type ScriptedTurn } from './fake-client.js';
import { runAgent, type AgentConfig, type AgentRequest } from './loop.js';
import { TokenBudgetTrimmer } from './token-budget.js';
import { ToolRegistry, ToolRunner } from './tool-runner.js';
import { createToolDefinitions } from './tools.js';

const CONFIG: AgentConfig = { model: 'claude-test', maxSteps: 4, maxOutputTokens: 1024 };

function setup(turns: readonly ScriptedTurn[], overrides: Partial<AgentConfig> = {}) {
  const client = new FakeMessagesClient(turns);
  const registry = new ToolRegistry(createToolDefinitions());
  const deps = { client, registry, runner: new ToolRunner(registry), trimmer: new TokenBudgetTrimmer(10_000) };
  const request: AgentRequest = { messages: [{ role: 'user', content: 'A teaser for a ceramic studio' }], board: emptyStoryboard() };
  const run = (signal: AbortSignal = new AbortController().signal, req: AgentRequest = request) =>
    runAgent({ ...CONFIG, ...overrides }, deps, req, signal);
  return { client, run };
}

async function collect(events: AsyncIterable<AgentEvent>, onEvent?: (e: AgentEvent) => void): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) {
    out.push(event);
    onEvent?.(event);
  }
  return out;
}

const text = (t: string): ScriptedTurn['blocks'][number] => ({ type: 'text', text: t });
const tool = (id: string, name: string, input: unknown): ScriptedTurn['blocks'][number] => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const createCall = (id = 'toolu_1') =>
  tool(id, 'create_storyboard', { title: 'Clay', aspectRatio: '16:9', shots: [draft(), draft({ framing: 'close-up' })] });

describe('runAgent: text only', () => {
  it('streams text deltas then finishes', async () => {
    const { run } = setup([{ blocks: [text('Hello there friend')] }]);
    const events = await collect(run());
    expect(events.filter((e) => e.type === 'text_delta').map((e) => (e.type === 'text_delta' ? e.text : '')).join('')).toBe(
      'Hello there friend',
    );
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'end_turn' });
  });

  it('sends the tools, the cacheable house style, the board and the history', async () => {
    const { run, client } = setup([{ blocks: [text('ok')] }]);
    await collect(run());
    const request = client.requests[0];
    expect(request?.model).toBe('claude-test');
    expect(request?.tools).toHaveLength(6);
    const first = request?.tools?.[0];
    expect(first && 'input_schema' in first && first.input_schema.type).toBe('object');
    const system = request?.system;
    expect(Array.isArray(system) && system).toHaveLength(2);
    expect(request?.messages).toEqual([{ role: 'user', content: 'A teaser for a ceramic studio' }]);
  });

  it.each([
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
  ] as const)('maps stop reason %s', async (stopReason, reason) => {
    const { run } = setup([{ blocks: [text('...')], stopReason }]);
    expect((await collect(run())).at(-1)).toEqual({ type: 'finished', reason });
  });
});

describe('runAgent: tool use', () => {
  it('applies a tool call, emits the board, and feeds the result back', async () => {
    const { run, client } = setup([{ blocks: [text('Drafting.'), createCall()] }, { blocks: [text('Done.')] }]);
    const events = await collect(run());

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'text_delta',
      'tool_started',
      'tool_finished',
      'board',
      'text_delta',
      'finished',
    ]);
    const board = events.find((e) => e.type === 'board');
    expect(board?.type === 'board' && board.board.shots).toHaveLength(2);

    const second = client.requests[1];
    const last = second?.messages.at(-1);
    expect(last?.role).toBe('user');
    expect(last?.content).toEqual([
      expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_1', content: expect.stringContaining('Created "Clay"') }),
    ]);
    expect(JSON.stringify(last)).not.toContain('is_error');
    expect(second?.messages.at(-2)?.role).toBe('assistant');
  });

  it('shows the updated board to the model on the next step', async () => {
    const { run, client } = setup([{ blocks: [createCall()] }, { blocks: [text('ok')] }]);
    await collect(run());
    const system = client.requests[1]?.system;
    expect(JSON.stringify(system)).toContain('Storyboard \\"Clay\\"');
  });

  it('feeds a reducer error back as is_error and keeps the board unchanged', async () => {
    const board = boardWithShots(2);
    const { run, client } = setup(
      [
        { blocks: [tool('toolu_9', 'update_shot', { shotId: 'shot_9', patch: { framing: 'wide' } })] },
        { blocks: [tool('toolu_10', 'update_shot', { shotId: 'shot_2', patch: { framing: 'close-up' } })] },
        { blocks: [text('Fixed.')] },
      ],
      { maxSteps: 5 },
    );
    const events = await collect(run(undefined, { messages: [{ role: 'user', content: 'edit' }], board }));

    const failed = events.find((e) => e.type === 'tool_finished' && !e.ok);
    expect(failed).toMatchObject({ tool: 'update_shot', ok: false });
    expect(events.filter((e) => e.type === 'board')).toHaveLength(1);

    const result = client.requests[1]?.messages.at(-1)?.content;
    expect(result).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu_9',
        is_error: true,
        content: expect.stringContaining('shot_1, shot_2'),
      }),
    ]);
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'end_turn' });
  });

  it('reports schema violations as is_error without touching the board', async () => {
    const { run, client } = setup([
      { blocks: [tool('t1', 'create_storyboard', { title: 'x', aspectRatio: '2:1', shots: [] })] },
      { blocks: [text('sorry')] },
    ]);
    const events = await collect(run());
    expect(events.some((e) => e.type === 'board')).toBe(false);
    expect(JSON.stringify(client.requests[1]?.messages.at(-1))).toContain('"is_error":true');
  });

  it('rejects unknown tools', async () => {
    const { run, client } = setup([{ blocks: [tool('t1', 'delete_everything', {})] }, { blocks: [text('ok')] }]);
    const events = await collect(run());
    expect(events.find((e) => e.type === 'tool_finished')).toMatchObject({ ok: false });
    expect(JSON.stringify(client.requests[1]?.messages.at(-1))).toContain('Unknown tool');
  });

  it('answers every tool_use of a parallel turn, applying them in order', async () => {
    const board = boardWithShots(2);
    const { run, client } = setup([
      {
        blocks: [
          tool('a', 'update_shot', { shotId: 'shot_1', patch: { durationSeconds: 2 } }),
          tool('b', 'remove_shot', { shotId: 'shot_2' }),
        ],
      },
      { blocks: [text('ok')] },
    ]);
    const events = await collect(run(undefined, { messages: [{ role: 'user', content: 'go' }], board }));
    const boards = events.filter((e) => e.type === 'board');
    expect(boards.map((e) => (e.type === 'board' ? e.board.shots.length : 0))).toEqual([2, 1]);
    const results = client.requests[1]?.messages.at(-1)?.content;
    expect(Array.isArray(results) && results.map((r) => ('tool_use_id' in r ? r.tool_use_id : ''))).toEqual(['a', 'b']);
  });

  it('asks the client to render when the model calls generate_shot', async () => {
    const board = boardWithShots(2);
    const { run } = setup([
      { blocks: [tool('g', 'generate_shot', { shotId: 'shot_2', mode: 'video' })] },
      { blocks: [text('Rendering.')] },
    ]);
    const events = await collect(run(undefined, { messages: [{ role: 'user', content: 'render 2' }], board }));
    expect(events).toContainEqual({ type: 'generation_requested', shotId: 'shot_2', mode: 'video' });
  });
});

describe('runAgent: limits and cancellation', () => {
  it('stops at the step limit when the model keeps calling tools', async () => {
    const looping: ScriptedTurn = { blocks: [createCall('loop')] };
    const { run, client } = setup([looping, looping, looping, looping, looping], { maxSteps: 3 });
    const events = await collect(run());
    expect(client.requests).toHaveLength(3);
    expect(events.filter((e) => e.type === 'tool_finished')).toHaveLength(3);
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'step_limit' });
  });

  it('does not call the model when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, client } = setup([{ blocks: [text('never')] }]);
    expect(await collect(run(controller.signal))).toEqual([{ type: 'finished', reason: 'cancelled' }]);
    expect(client.requests).toHaveLength(0);
  });

  it('cancels mid-stream', async () => {
    const controller = new AbortController();
    const { run } = setup([{ blocks: [text('one two three four five six')] }]);
    const events = await collect(run(controller.signal), (e) => {
      if (e.type === 'text_delta') controller.abort();
    });
    expect(events.filter((e) => e.type === 'text_delta')).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'cancelled' });
  });

  it('cancels between steps without starting another model call', async () => {
    const controller = new AbortController();
    const { run, client } = setup([{ blocks: [createCall()] }, { blocks: [text('never')] }]);
    const events = await collect(run(controller.signal), (e) => {
      if (e.type === 'tool_finished') controller.abort();
    });
    expect(client.requests).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'cancelled' });
  });

  it('reports a failing model call as a failed event', async () => {
    const registry = new ToolRegistry(createToolDefinitions());
    const client = {
      messages: {
        stream: (): never => {
          throw new Error('upstream exploded');
        },
      },
    };
    const events = await collect(
      runAgent(
        CONFIG,
        { client, registry, runner: new ToolRunner(registry), trimmer: new TokenBudgetTrimmer(1000) },
        { messages: [{ role: 'user', content: 'hi' }], board: emptyStoryboard() },
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([{ type: 'failed', message: 'upstream exploded' }]);
  });
});

describe('runAgent: context budget', () => {
  it('sends only the messages that fit the budget, newest first priority', async () => {
    const client = new FakeMessagesClient([{ blocks: [text('ok')] }]);
    const registry = new ToolRegistry(createToolDefinitions());
    const deps = { client, registry, runner: new ToolRunner(registry), trimmer: new TokenBudgetTrimmer(30) };
    const messages = [
      { role: 'user', content: 'x'.repeat(200) },
      { role: 'assistant', content: 'y'.repeat(200) },
      { role: 'user', content: 'latest question' },
    ] as const;
    await collect(runAgent(CONFIG, deps, { messages, board: emptyStoryboard() }, new AbortController().signal));
    expect(client.requests[0]?.messages).toEqual([{ role: 'user', content: 'latest question' }]);
  });
});
