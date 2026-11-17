import { describe, expect, it } from 'vitest';
import type { GenerationEvent } from '../domain/generation.js';
import { boardWithShots } from '../domain/fixtures.js';
import type { Shot } from '../domain/shot.js';
import { MockImageProvider, MockVideoProvider, mockClipUrl, mockKeyframeUrl } from '../providers/mock-providers.js';
import { InstantSleeper, ManualClock } from '../providers/test-doubles.js';
import type { AnimateRequest, ImageProvider, VideoJob, VideoJobStatus, VideoProvider } from '../providers/types.js';
import { GenerationService, motionPrompt } from './generation-service.js';

const polling = { intervalMs: 1000, timeoutMs: 10_000 };

function shot(overrides: Partial<Shot> = {}): Shot {
  const base = boardWithShots(1).shots[0];
  if (!base) throw new Error('fixture');
  return { ...base, ...overrides };
}

async function collect(stream: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function mockService() {
  const clock = new ManualClock();
  const sleeper = new InstantSleeper(clock);
  return new GenerationService(new MockImageProvider(sleeper, 500), new MockVideoProvider(clock, 3000), sleeper, polling);
}

const signal = () => new AbortController().signal;

describe('GenerationService', () => {
  it('renders a keyframe in image mode', async () => {
    const target = shot();
    const events = await collect(mockService().run({ shot: target, aspectRatio: '16:9', mode: 'image' }, signal()));
    expect(events.map((e) => e.type)).toEqual(['generation_state', 'keyframe_ready', 'generation_state']);
    expect(events[1]).toEqual({ type: 'keyframe_ready', shotId: target.id, url: mockKeyframeUrl(target.prompt, '16:9') });
    expect(events.at(-1)).toMatchObject({ generation: { status: 'done', mode: 'image' } });
  });

  it('makes the keyframe first in video mode when the shot has none, then polls to a clip', async () => {
    const target = shot();
    const events = await collect(mockService().run({ shot: target, aspectRatio: '16:9', mode: 'video' }, signal()));
    const types = events.map((e) => e.type);
    expect(types.indexOf('keyframe_ready')).toBeLessThan(types.indexOf('clip_ready'));
    expect(events.find((e) => e.type === 'clip_ready')).toMatchObject({
      clip: { url: mockClipUrl(target.prompt, '16:9', target.durationSeconds), mimeType: 'image/svg+xml' },
    });
    const progress = events.flatMap((e) =>
      e.type === 'generation_state' && e.generation.status === 'generating' && e.generation.stage === 'clip'
        ? [e.generation.progress]
        : [],
    );
    expect(progress.length).toBeGreaterThan(2);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(events.at(-1)).toMatchObject({ generation: { status: 'done', mode: 'video' } });
  });

  it('reuses an existing keyframe in video mode', async () => {
    const failingImage: ImageProvider = {
      generate: () => Promise.reject(new Error('should not be called')),
    };
    const clock = new ManualClock();
    const sleeper = new InstantSleeper(clock);
    const service = new GenerationService(failingImage, new MockVideoProvider(clock, 1000), sleeper, polling);
    const events = await collect(
      service.run({ shot: shot({ keyframeUrl: 'https://cdn/k.png' }), aspectRatio: '16:9', mode: 'video' }, signal()),
    );
    expect(events.some((e) => e.type === 'keyframe_ready')).toBe(false);
    expect(events.some((e) => e.type === 'clip_ready')).toBe(true);
  });

  it('turns an image provider error into a failed state', async () => {
    const image: ImageProvider = { generate: () => Promise.reject(new Error('quota exceeded')) };
    const clock = new ManualClock();
    const service = new GenerationService(image, new MockVideoProvider(clock), new InstantSleeper(clock), polling);
    const events = await collect(service.run({ shot: shot(), aspectRatio: '16:9', mode: 'image' }, signal()));
    expect(events.at(-1)).toMatchObject({ generation: { status: 'failed', mode: 'image', error: 'quota exceeded' } });
  });

  function scriptedVideo(statuses: VideoJobStatus[]): VideoProvider {
    return {
      animate: (_request: AnimateRequest): Promise<VideoJob> => Promise.resolve({ id: 'j' }),
      poll: () => Promise.resolve(statuses.shift() ?? { status: 'running', progress: 0.1 }),
    };
  }

  it('reports a failed video job', async () => {
    const clock = new ManualClock();
    const service = new GenerationService(
      new MockImageProvider(new InstantSleeper(clock)),
      scriptedVideo([{ status: 'running', progress: 0.2 }, { status: 'failed', error: 'content moderation' }]),
      new InstantSleeper(clock),
      polling,
    );
    const events = await collect(service.run({ shot: shot(), aspectRatio: '16:9', mode: 'video' }, signal()));
    expect(events.at(-1)).toMatchObject({ generation: { status: 'failed', error: 'content moderation' } });
    expect(events.some((e) => e.type === 'clip_ready')).toBe(false);
  });

  it('gives up when the job never finishes', async () => {
    const clock = new ManualClock();
    const sleeper = new InstantSleeper(clock);
    const service = new GenerationService(new MockImageProvider(sleeper), scriptedVideo([]), sleeper, {
      intervalMs: 1000,
      timeoutMs: 3000,
    });
    const events = await collect(service.run({ shot: shot(), aspectRatio: '16:9', mode: 'video' }, signal()));
    expect(events.at(-1)).toMatchObject({ generation: { status: 'failed', error: expect.stringContaining('Timed out') } });
  });

  it('stops quietly when cancelled', async () => {
    const controller = new AbortController();
    const service = mockService();
    const events: GenerationEvent[] = [];
    for await (const event of service.run({ shot: shot(), aspectRatio: '16:9', mode: 'video' }, controller.signal)) {
      events.push(event);
      controller.abort();
    }
    expect(events).toHaveLength(1);
  });
});

describe('motionPrompt', () => {
  it('appends the camera move in words', () => {
    expect(motionPrompt(shot({ prompt: 'A bowl.', cameraMove: 'dolly-in' }))).toBe('A bowl. Camera: dolly in.');
  });
});
