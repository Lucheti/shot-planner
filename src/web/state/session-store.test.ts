import { describe, expect, it } from 'vitest';
import { boardWithShots } from '../../domain/fixtures.js';
import type { AgentEvent } from '../../protocol/messages.js';
import { aborted, deferred, FakeApi } from '../test-support/fake-api.js';
import { createSessionStore } from './session-store.js';

let counter = 0;
const newId = () => `id_${(counter += 1)}`;

const helloTurn = (): AgentEvent[] => [
  { type: 'text_delta', text: 'Hi there.' },
  { type: 'finished', reason: 'end_turn' },
];

describe('send', () => {
  it('streams the reply into the transcript and replays history on the next turn', async () => {
    const api = new FakeApi({ chat: helloTurn });
    const store = createSessionStore({ api, newId });

    await store.getState().send('  first brief  ');
    expect(store.getState().chatRunning).toBe(false);
    expect(store.getState().transcript.map((e) => e.role)).toEqual(['user', 'assistant']);

    await store.getState().send('second');
    expect(api.chatRequests[1]?.messages).toEqual([
      { role: 'user', content: 'first brief' },
      { role: 'assistant', content: 'Hi there.' },
      { role: 'user', content: 'second' },
    ]);
  });

  it('ignores blank input and overlapping sends', async () => {
    const gate = deferred();
    const api = new FakeApi({
      chat: async function* () {
        await gate.promise;
        yield* helloTurn();
      },
    });
    const store = createSessionStore({ api, newId });
    await store.getState().send('   ');
    expect(api.chatRequests).toHaveLength(0);

    const first = store.getState().send('one');
    await store.getState().send('two');
    expect(api.chatRequests).toHaveLength(1);
    gate.resolve();
    await first;
  });

  it('applies board snapshots and starts the generations the agent requests', async () => {
    const board = boardWithShots(2);
    const api = new FakeApi({
      chat: () => [
        { type: 'board', board },
        { type: 'generation_requested', shotId: 'shot_2', mode: 'image' },
        { type: 'finished', reason: 'end_turn' },
      ],
      generate: (request) => [
        { type: 'keyframe_ready', shotId: request.shotId, url: '/k2.svg' },
        { type: 'generation_state', shotId: request.shotId, generation: { status: 'done', mode: 'image' } },
      ],
    });
    const store = createSessionStore({ api, newId });
    await store.getState().send('draft and render 2');
    await flush();

    expect(store.getState().board.shots).toHaveLength(2);
    expect(store.getState().board.shots[1]).toMatchObject({ keyframeUrl: '/k2.svg', generation: { status: 'done' } });
    expect(api.generateRequests[0]).toMatchObject({ shotId: 'shot_2', mode: 'image' });
  });

  it('shows a failed turn and recovers', async () => {
    const api = new FakeApi({
      chat: async function* () {
        yield { type: 'text_delta', text: 'partial' } as const;
        throw new Error('network down');
      },
    });
    const store = createSessionStore({ api, newId });
    await store.getState().send('go');
    expect(store.getState().error).toBe('network down');
    expect(store.getState().chatRunning).toBe(false);
    store.getState().dismissError();
    expect(store.getState().error).toBeNull();
  });

  it('stops a running turn with the stop button', async () => {
    const api = new FakeApi({
      chat: async function* (_request, signal) {
        yield { type: 'text_delta', text: 'working' } as const;
        await aborted(signal);
        throw new Error('aborted');
      },
    });
    const store = createSessionStore({ api, newId });
    const turn = store.getState().send('long task');
    await flush();
    expect(store.getState().chatRunning).toBe(true);
    store.getState().stop();
    await turn;

    const last = store.getState().transcript.at(-1);
    expect(store.getState().chatRunning).toBe(false);
    expect(store.getState().error).toBeNull();
    expect(last?.role === 'assistant' && last.parts.at(-1)).toEqual({ kind: 'notice', text: 'Stopped.' });
  });
});

function storeWithBoard(api: FakeApi, shots = 2) {
  const store = createSessionStore({ api, newId });
  store.setState({ board: boardWithShots(shots) });
  return store;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('generate', () => {
  it('walks a shot through queued, generating and done, sending the current board', async () => {
    const seen: string[] = [];
    const gate = deferred();
    const api = new FakeApi({
      generate: async function* (request) {
        yield {
          type: 'generation_state',
          shotId: request.shotId,
          generation: { status: 'generating', mode: 'video', stage: 'clip', progress: 0.5 },
        } as const;
        await gate.promise;
        yield { type: 'clip_ready', shotId: request.shotId, clip: { url: '/c.svg', mimeType: 'image/svg+xml' } } as const;
        yield { type: 'generation_state', shotId: request.shotId, generation: { status: 'done', mode: 'video' } } as const;
      },
    });
    const store = storeWithBoard(api);
    store.subscribe((s) => seen.push(s.board.shots[0]?.generation.status ?? ''));

    const run = store.getState().generate('shot_1', 'video');
    await flush();
    expect(store.getState().board.shots[0]?.generation).toMatchObject({ status: 'generating', progress: 0.5 });
    gate.resolve();
    await run;

    expect(store.getState().board.shots[0]).toMatchObject({ clip: { url: '/c.svg' }, generation: { status: 'done' } });
    expect(seen[0]).toBe('queued');
    expect(api.generateRequests[0]?.board.shots).toHaveLength(2);
  });

  it('does not start a second render for a shot that is already running', async () => {
    const gate = deferred();
    const api = new FakeApi({
      generate: async function* () {
        await gate.promise;
        yield { type: 'stream_error', message: 'released' } as const;
      },
    });
    const store = storeWithBoard(api);
    const first = store.getState().generate('shot_1', 'image');
    await store.getState().generate('shot_1', 'image');
    expect(api.generateRequests).toHaveLength(1);
    gate.resolve();
    await first;
  });

  it('marks the shot failed on a stream error message or a thrown error', async () => {
    const api = new FakeApi({
      generate: (request) =>
        request.shotId === 'shot_1'
          ? [{ type: 'stream_error' as const, message: 'quota' }]
          : (() => {
              throw new Error('socket closed');
            })(),
    });
    const store = storeWithBoard(api);
    await store.getState().generate('shot_1', 'image');
    await store.getState().generate('shot_2', 'image');
    expect(store.getState().board.shots[0]?.generation).toEqual({ status: 'failed', mode: 'image', error: 'quota' });
    expect(store.getState().board.shots[1]?.generation).toMatchObject({ status: 'failed', error: 'socket closed' });
  });

  it('cancels back to idle', async () => {
    const api = new FakeApi({
      generate: async function* (_request, signal) {
        yield { type: 'generation_state', shotId: 'shot_1', generation: { status: 'generating', mode: 'image', stage: 'keyframe', progress: 0.1 } } as const;
        await aborted(signal);
      },
    });
    const store = storeWithBoard(api);
    const run = store.getState().generate('shot_1', 'image');
    await flush();
    store.getState().cancelGeneration('shot_1');
    await run;
    expect(store.getState().board.shots[0]?.generation).toEqual({ status: 'idle' });
  });

  it('ignores unknown shots', async () => {
    const api = new FakeApi();
    await storeWithBoard(api).getState().generate('nope', 'image');
    expect(api.generateRequests).toHaveLength(0);
  });
});

describe('generateAll', () => {
  it('renders every shot with bounded concurrency', async () => {
    let active = 0;
    let peak = 0;
    const api = new FakeApi({
      generate: async function* (request) {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield { type: 'generation_state', shotId: request.shotId, generation: { status: 'done', mode: 'image' } } as const;
        active -= 1;
      },
    });
    const store = createSessionStore({ api, newId, renderConcurrency: 2 });
    store.setState({ board: boardWithShots(5) });
    await store.getState().generateAll('image');
    expect(api.generateRequests).toHaveLength(5);
    expect(peak).toBe(2);
    expect(store.getState().board.shots.every((s) => s.generation.status === 'done')).toBe(true);
  });
});

describe('reset and info', () => {
  it('clears the board and transcript but keeps the server info', async () => {
    const api = new FakeApi({ chat: helloTurn });
    const store = createSessionStore({ api, newId });
    await store.getState().loadInfo();
    await store.getState().send('hello');
    store.setState({ board: boardWithShots(2) });
    store.getState().reset();
    expect(store.getState().board.shots).toHaveLength(0);
    expect(store.getState().transcript).toHaveLength(0);
    expect(store.getState().info?.planner).toBe('mock');
  });
});
