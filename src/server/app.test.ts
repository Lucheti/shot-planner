import { describe, expect, it } from 'vitest';
import { DemoPlanner } from '../agent/demo/demo-planner.js';
import { createDemoIntents } from '../agent/demo/intents.js';
import type { AgentRunner } from '../agent/loop.js';
import { ToolRegistry, ToolRunner } from '../agent/tool-runner.js';
import { createToolDefinitions } from '../agent/tools.js';
import { boardWithShots } from '../domain/fixtures.js';
import { emptyStoryboard } from '../domain/storyboard.js';
import { GenerationService } from '../generation/generation-service.js';
import { agentEventSchema, generateStreamMessageSchema, type AgentEvent, type AppInfo } from '../protocol/messages.js';
import { SseParser } from '../protocol/sse.js';
import { MockImageProvider, MockVideoProvider, mockKeyframeUrl } from '../providers/mock-providers.js';
import { InstantSleeper, ManualClock } from '../providers/test-doubles.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const info: AppInfo = { planner: 'mock', providers: 'mock', model: null };

function makeApp(agent?: AgentRunner) {
  const clock = new ManualClock();
  const sleeper = new InstantSleeper(clock);
  const runner = new ToolRunner(new ToolRegistry(createToolDefinitions()));
  return createApp({
    agent: agent ?? new DemoPlanner(createDemoIntents(), runner, sleeper),
    generation: new GenerationService(new MockImageProvider(sleeper), new MockVideoProvider(clock, 2000), sleeper, {
      intervalMs: 500,
      timeoutMs: 10_000,
    }),
    info,
    staticRoot: null,
  });
}

const post = (app: ReturnType<typeof makeApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function frames(response: Response) {
  return new SseParser().push(await response.text()).map((frame) => ({ event: frame.event, data: JSON.parse(frame.data) as unknown }));
}

describe('GET /api/info and routing', () => {
  it('reports the mode the server composed', async () => {
    const response = await makeApp().request('/api/info');
    expect(await response.json()).toEqual(info);
  });

  it('answers unknown api paths with 404 json', async () => {
    expect((await makeApp().request('/api/nope')).status).toBe(404);
  });
});

describe('POST /api/chat', () => {
  it('streams typed agent events as SSE', async () => {
    const response = await post(makeApp(), '/api/chat', {
      messages: [{ role: 'user', content: 'A teaser for a bakery' }],
      board: emptyStoryboard(),
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const received = await frames(response);
    expect(received.length).toBeGreaterThan(3);
    for (const frame of received) {
      const event = agentEventSchema.parse(frame.data);
      expect(frame.event).toBe(event.type);
    }
    expect(received.at(-1)?.event).toBe('finished');
  });

  it('runs a whole demo turn through the reducer and ends with a board snapshot', async () => {
    const response = await post(makeApp(), '/api/chat', {
      messages: [
        { role: 'user', content: 'A 20-second teaser for a ceramic studio, warm morning light' },
        { role: 'assistant', content: 'Questions?' },
        { role: 'user', content: 'yes, 16:9 with a logo' },
      ],
      board: emptyStoryboard(),
    });
    const events = (await frames(response)).map((f) => agentEventSchema.parse(f.data));
    const boards = events.filter((e): e is Extract<AgentEvent, { type: 'board' }> => e.type === 'board');
    expect(boards).toHaveLength(1);
    expect(boards[0]?.board.shots).toHaveLength(6);
  });

  it.each([
    ['malformed json', 'not json'],
    ['no messages', JSON.stringify({ messages: [], board: emptyStoryboard() })],
    ['a board that fails validation', JSON.stringify({ messages: [{ role: 'user', content: 'x' }], board: { title: 3 } })],
  ])('rejects %s with 400', async (_label, raw) => {
    const response = await makeApp().request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });
    expect(response.status).toBe(400);
  });

  it('reports a thrown agent error as a failed event', async () => {
    const exploding: AgentRunner = {
      // eslint-disable-next-line require-yield
      run: async function* () {
        throw new Error('model unavailable');
      },
    };
    const response = await post(makeApp(exploding), '/api/chat', {
      messages: [{ role: 'user', content: 'x' }],
      board: emptyStoryboard(),
    });
    expect((await frames(response)).map((f) => f.data)).toEqual([{ type: 'failed', message: 'model unavailable' }]);
  });

  it('hands the agent an abort signal that fires when the stream is cancelled', async () => {
    let captured: AbortSignal | undefined;
    const waiting: AgentRunner = {
      run: async function* (_request, signal) {
        captured = signal;
        yield { type: 'text_delta', text: 'a' } as const;
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      },
    };
    const response = await post(makeApp(waiting), '/api/chat', {
      messages: [{ role: 'user', content: 'x' }],
      board: emptyStoryboard(),
    });
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(captured?.aborted).toBe(true);
  });
});

describe('POST /api/generate', () => {
  it('streams a keyframe render to completion', async () => {
    const board = boardWithShots(2);
    const response = await post(makeApp(), '/api/generate', { board, shotId: 'shot_2', mode: 'image' });
    const messages = (await frames(response)).map((f) => generateStreamMessageSchema.parse(f.data));
    expect(messages.map((m) => m.type)).toEqual(['generation_state', 'keyframe_ready', 'generation_state']);
    expect(messages[1]).toEqual({
      type: 'keyframe_ready',
      shotId: 'shot_2',
      url: mockKeyframeUrl(board.shots[1]?.prompt ?? '', '16:9'),
    });
  });

  it('streams a video render with a clip at the end', async () => {
    const response = await post(makeApp(), '/api/generate', { board: boardWithShots(1), shotId: 'shot_1', mode: 'video' });
    const types = (await frames(response)).map((f) => f.event);
    expect(types).toContain('clip_ready');
    expect(types.at(-1)).toBe('generation_state');
  });

  it('404s for an unknown shot and 400s for a bad body', async () => {
    expect((await post(makeApp(), '/api/generate', { board: boardWithShots(1), shotId: 'zzz', mode: 'image' })).status).toBe(404);
    expect((await post(makeApp(), '/api/generate', { shotId: 'a' })).status).toBe(400);
  });
});

describe('mock art routes', () => {
  it('serve deterministic, cacheable svg', async () => {
    const url = mockKeyframeUrl('clay bowl', '16:9');
    const a = await makeApp().request(url);
    const b = await makeApp().request(url);
    expect(a.headers.get('content-type')).toContain('image/svg+xml');
    expect(a.headers.get('cache-control')).toContain('immutable');
    expect(await a.text()).toBe(await b.text());
  });

  it('serves animated clips and rejects bad queries', async () => {
    const clip = await makeApp().request('/api/mock/clip.svg?p=clay&r=1:1&s=6');
    expect(await clip.text()).toContain('animation:push 6s');
    expect((await makeApp().request('/api/mock/clip.svg?p=clay&r=nope')).status).toBe(400);
  });
});

describe('loadConfig', () => {
  it('defaults to demo mode with the documented model', () => {
    const config = loadConfig({});
    expect(config.anthropic).toMatchObject({ apiKey: null, model: 'claude-sonnet-5-5', maxSteps: 8 });
    expect(config.runway.apiKey).toBeNull();
    expect(config.port).toBe(8787);
  });

  it('treats blank values from an untouched .env as unset', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: '', RUNWAYML_API_SECRET: ' ', AGENT_MAX_STEPS: '' });
    expect(config.anthropic.apiKey).toBeNull();
    expect(config.anthropic.model).toBe('claude-sonnet-5-5');
    expect(config.runway.apiKey).toBeNull();
    expect(config.anthropic.maxSteps).toBe(8);
  });

  it('reads overrides and rejects invalid ones', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-opus-5-5', RUNWAY_VIDEO_MODEL: 'gen4_turbo', PORT: '9000' });
    expect(config.anthropic).toMatchObject({ apiKey: 'k', model: 'claude-opus-5-5' });
    expect(config.runway.videoModel).toBe('gen4_turbo');
    expect(config.port).toBe(9000);
    expect(() => loadConfig({ RUNWAY_VIDEO_MODEL: 'gen9' })).toThrow();
    expect(() => loadConfig({ PORT: '-1' })).toThrow();
  });
});
