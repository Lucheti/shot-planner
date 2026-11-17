import { describe, expect, it } from 'vitest';
import { renderClipSvg, renderKeyframeSvg } from './mock-art.js';
import {
  MockImageProvider,
  MockVideoProvider,
  mockArtQuerySchema,
  mockClipUrl,
  mockKeyframeUrl,
} from './mock-providers.js';
import { InstantSleeper, ManualClock } from './test-doubles.js';

describe('mock art', () => {
  it('is deterministic per prompt and aspect ratio', () => {
    expect(renderKeyframeSvg('a potter at dawn', '16:9')).toBe(renderKeyframeSvg('a potter at dawn', '16:9'));
    expect(renderKeyframeSvg('a potter at dawn', '16:9')).not.toBe(renderKeyframeSvg('a night street', '16:9'));
    expect(renderKeyframeSvg('a potter at dawn', '16:9')).not.toBe(renderKeyframeSvg('a potter at dawn', '9:16'));
  });

  it('sizes the canvas from the aspect ratio', () => {
    expect(renderKeyframeSvg('x', '9:16')).toContain('viewBox="0 0 720 1280"');
    expect(renderKeyframeSvg('x', '21:9')).toContain('viewBox="0 0 1400 600"');
  });

  it('produces well-formed svg documents', () => {
    for (const svg of [renderKeyframeSvg('x', '1:1'), renderClipSvg('x', '1:1', 3)]) {
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
    }
  });

  it('animates the clip for the shot duration around the same artwork', () => {
    const clip = renderClipSvg('a potter at dawn', '16:9', 6);
    expect(clip).toContain('animation:push 6s');
    const keyframeBody = renderKeyframeSvg('a potter at dawn', '16:9').replace(/^<svg[^>]*>|<\/svg>$/g, '');
    expect(clip).toContain(keyframeBody);
  });
});

describe('mock URLs', () => {
  it('encode prompts and round-trip through the query schema', () => {
    const url = mockClipUrl('warm light & clay?', '4:3', 5);
    const query = Object.fromEntries(new URLSearchParams(url.split('?')[1]));
    expect(mockArtQuerySchema.parse(query)).toEqual({ p: 'warm light & clay?', r: '4:3', s: 5 });
  });

  it('rejects unknown aspect ratios', () => {
    expect(mockArtQuerySchema.safeParse({ p: 'x', r: '5:1' }).success).toBe(false);
  });
});

describe('MockImageProvider', () => {
  it('waits, then returns the keyframe URL for the prompt', async () => {
    const sleeper = new InstantSleeper();
    const url = await new MockImageProvider(sleeper, 750).generate('clay bowl', '16:9');
    expect(url).toBe(mockKeyframeUrl('clay bowl', '16:9'));
    expect(sleeper.sleeps).toEqual([750]);
  });

  it('is cancellable', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new MockImageProvider(new InstantSleeper()).generate('x', '16:9', controller.signal)).rejects.toThrow();
  });
});

describe('MockVideoProvider', () => {
  const request = (imageUrl: string) => ({ imageUrl, prompt: 'motion prompt', seconds: 3, aspectRatio: '16:9' as const });

  it('reports linear progress and then the clip', async () => {
    const clock = new ManualClock();
    const provider = new MockVideoProvider(clock, 4000);
    const job = await provider.animate(request(mockKeyframeUrl('clay bowl', '16:9')));

    expect(await provider.poll(job)).toEqual({ status: 'running', progress: 0 });
    clock.advance(1000);
    expect(await provider.poll(job)).toEqual({ status: 'running', progress: 0.25 });
    clock.advance(3000);
    const done = await provider.poll(job);
    expect(done).toEqual({
      status: 'succeeded',
      clip: { url: mockClipUrl('clay bowl', '16:9', 3), mimeType: 'image/svg+xml' },
    });
  });

  it('falls back to the request prompt for foreign image URLs', async () => {
    const clock = new ManualClock();
    const provider = new MockVideoProvider(clock, 10);
    const job = await provider.animate(request('https://example.com/a.png'));
    clock.advance(10);
    const done = await provider.poll(job);
    expect(done.status === 'succeeded' && done.clip.url).toBe(mockClipUrl('motion prompt', '16:9', 3));
  });

  it('gives each job its own id and fails unknown jobs', async () => {
    const provider = new MockVideoProvider(new ManualClock());
    const a = await provider.animate(request('x'));
    const b = await provider.animate(request('x'));
    expect(a.id).not.toBe(b.id);
    expect((await provider.poll({ id: 'nope' })).status).toBe('failed');
  });
});
