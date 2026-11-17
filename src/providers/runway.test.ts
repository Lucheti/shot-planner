import type RunwayML from '@runwayml/sdk';
import { describe, expect, it } from 'vitest';
import {
  RunwayImageProvider,
  RunwaySdkApi,
  RunwayVideoProvider,
  type RunwayApi,
  type RunwayTask,
} from './runway.js';
import { InstantSleeper } from './test-doubles.js';

class ScriptedApi implements RunwayApi {
  public readonly started: unknown[] = [];

  constructor(private readonly tasks: RunwayTask[]) {}

  public startImage(prompt: string, aspectRatio: string): Promise<string> {
    this.started.push({ prompt, aspectRatio });
    return Promise.resolve('task_1');
  }

  public startVideo(request: unknown, model: string): Promise<string> {
    this.started.push({ request, model });
    return Promise.resolve('task_2');
  }

  public getTask(): Promise<RunwayTask> {
    const next = this.tasks.shift() ?? this.tasks[0];
    return Promise.resolve(next ?? { status: 'running', progress: 0 });
  }
}

const polling = { intervalMs: 1000, timeoutMs: 3000 };

describe('RunwayImageProvider', () => {
  it('polls until the task succeeds and returns the first output', async () => {
    const api = new ScriptedApi([
      { status: 'running', progress: 0 },
      { status: 'succeeded', outputUrls: ['https://cdn/a.png', 'https://cdn/b.png'] },
    ]);
    const sleeper = new InstantSleeper();
    const url = await new RunwayImageProvider(api, sleeper, polling).generate('clay', '16:9');
    expect(url).toBe('https://cdn/a.png');
    expect(api.started).toEqual([{ prompt: 'clay', aspectRatio: '16:9' }]);
    expect(sleeper.sleeps).toEqual([1000]);
  });

  it('surfaces a failed task', async () => {
    const api = new ScriptedApi([{ status: 'failed', reason: 'moderation' }]);
    await expect(new RunwayImageProvider(api, new InstantSleeper(), polling).generate('x', '16:9')).rejects.toThrow(
      /moderation/,
    );
  });

  it('times out, and rejects an empty output', async () => {
    const stuck = new ScriptedApi([{ status: 'running', progress: 0.1 }]);
    await expect(new RunwayImageProvider(stuck, new InstantSleeper(), polling).generate('x', '16:9')).rejects.toThrow(
      /timed out/,
    );
    const empty = new ScriptedApi([{ status: 'succeeded', outputUrls: [] }]);
    await expect(new RunwayImageProvider(empty, new InstantSleeper(), polling).generate('x', '16:9')).rejects.toThrow(
      /no image/,
    );
  });
});

describe('RunwayVideoProvider', () => {
  const request = { imageUrl: 'https://cdn/a.png', prompt: 'p', seconds: 4, aspectRatio: '16:9' as const };

  it('starts a task with the configured model and maps each poll status', async () => {
    const api = new ScriptedApi([
      { status: 'running', progress: 0.4 },
      { status: 'failed', reason: 'bad' },
      { status: 'succeeded', outputUrls: ['https://cdn/v.mp4'] },
      { status: 'succeeded', outputUrls: [] },
    ]);
    const provider = new RunwayVideoProvider(api, 'gen4_turbo');
    const job = await provider.animate(request);
    expect(job).toEqual({ id: 'task_2' });
    expect(api.started[0]).toMatchObject({ model: 'gen4_turbo' });
    expect(await provider.poll(job)).toEqual({ status: 'running', progress: 0.4 });
    expect(await provider.poll(job)).toEqual({ status: 'failed', error: 'bad' });
    expect(await provider.poll(job)).toEqual({
      status: 'succeeded',
      clip: { url: 'https://cdn/v.mp4', mimeType: 'video/mp4' },
    });
    expect((await provider.poll(job)).status).toBe('failed');
  });
});

describe('RunwaySdkApi', () => {
  function fakeClient() {
    const calls: { kind: string; body: unknown }[] = [];
    const task = (id: string) => Promise.resolve({ id });
    const client = {
      textToImage: { create: (body: unknown) => (calls.push({ kind: 'image', body }), task('img')) },
      imageToVideo: { create: (body: unknown) => (calls.push({ kind: 'video', body }), task('vid')) },
      tasks: {
        retrieve: (id: string) =>
          Promise.resolve(
            id === 'ok'
              ? { id, status: 'SUCCEEDED', output: ['u'] }
              : id === 'run'
                ? { id, status: 'RUNNING', progress: 0.5 }
                : id === 'pend'
                  ? { id, status: 'THROTTLED' }
                  : id === 'cancel'
                    ? { id, status: 'CANCELLED' }
                    : { id, status: 'FAILED', failure: 'nope' },
          ),
      },
    };
    return { calls, api: new RunwaySdkApi(client as unknown as RunwayML) };
  }

  it('maps aspect ratios to Runway resolutions and clamps video seconds', async () => {
    const { api, calls } = fakeClient();
    expect(await api.startImage('a'.repeat(1200), '9:16')).toBe('img');
    expect(await api.startVideo({ imageUrl: 'u', prompt: 'm', seconds: 1, aspectRatio: '21:9' }, 'gen4.5')).toBe('vid');
    expect(calls[0]?.body).toMatchObject({ model: 'gen4_image', ratio: '1080:1920' });
    expect((calls[0]?.body as { promptText: string }).promptText).toHaveLength(1000);
    expect(calls[1]?.body).toMatchObject({
      model: 'gen4.5',
      promptImage: 'u',
      ratio: '1584:672',
      duration: 2,
    });
  });

  it('normalises task statuses', async () => {
    const { api } = fakeClient();
    expect(await api.getTask('ok')).toEqual({ status: 'succeeded', outputUrls: ['u'] });
    expect(await api.getTask('run')).toEqual({ status: 'running', progress: 0.5 });
    expect(await api.getTask('pend')).toEqual({ status: 'running', progress: 0 });
    expect(await api.getTask('cancel')).toMatchObject({ status: 'failed' });
    expect(await api.getTask('boom')).toEqual({ status: 'failed', reason: 'nope' });
  });
});
