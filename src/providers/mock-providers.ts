import { z } from 'zod';
import { aspectRatioSchema } from '../domain/schema.js';
import type { AspectRatio } from '../domain/shot.js';
import type { Clock, Sleeper } from './time.js';
import type { AnimateRequest, ImageProvider, VideoJob, VideoJobStatus, VideoProvider } from './types.js';

export const MOCK_KEYFRAME_PATH = '/api/mock/keyframe.svg';
export const MOCK_CLIP_PATH = '/api/mock/clip.svg';

/** The query the mock art routes accept. */
export const mockArtQuerySchema = z.object({
  p: z.string().max(2000),
  r: aspectRatioSchema,
  s: z.coerce.number().int().min(1).max(10).default(4),
});

/** URL of the mock keyframe for a prompt. Same inputs, same URL, same image. */
export function mockKeyframeUrl(prompt: string, aspectRatio: AspectRatio): string {
  return `${MOCK_KEYFRAME_PATH}?${new URLSearchParams({ p: prompt, r: aspectRatio })}`;
}

/** URL of the mock clip for a prompt. */
export function mockClipUrl(prompt: string, aspectRatio: AspectRatio, seconds: number): string {
  return `${MOCK_CLIP_PATH}?${new URLSearchParams({ p: prompt, r: aspectRatio, s: String(seconds) })}`;
}

/** Zero-key image provider: waits a moment, then returns a URL served by the mock art route. */
export class MockImageProvider implements ImageProvider {
  constructor(
    private readonly sleeper: Sleeper,
    private readonly latencyMs = 1100,
  ) {}

  public async generate(prompt: string, aspectRatio: AspectRatio, signal?: AbortSignal): Promise<string> {
    await this.sleeper.sleep(this.latencyMs, signal);
    return mockKeyframeUrl(prompt, aspectRatio);
  }
}

interface MockJob {
  readonly startedAt: number;
  readonly request: AnimateRequest;
}

/** Zero-key video provider: a job that "renders" for a fixed time and reports linear progress. */
export class MockVideoProvider implements VideoProvider {
  private readonly jobs = new Map<string, MockJob>();
  private sequence = 0;

  constructor(
    private readonly clock: Clock,
    private readonly renderMs = 4000,
  ) {}

  public animate(request: AnimateRequest): Promise<VideoJob> {
    this.sequence += 1;
    const id = `mock_job_${this.sequence}`;
    this.jobs.set(id, { startedAt: this.clock.now(), request });
    return Promise.resolve({ id });
  }

  public poll(job: VideoJob): Promise<VideoJobStatus> {
    const entry = this.jobs.get(job.id);
    if (!entry) return Promise.resolve({ status: 'failed', error: `Unknown job ${job.id}` });
    const progress = Math.min(1, (this.clock.now() - entry.startedAt) / this.renderMs);
    if (progress < 1) return Promise.resolve({ status: 'running', progress });
    this.jobs.delete(job.id);
    const { imageUrl, prompt, aspectRatio, seconds } = entry.request;
    const artPrompt = promptOfMockKeyframe(imageUrl) ?? prompt;
    return Promise.resolve({
      status: 'succeeded',
      clip: { url: mockClipUrl(artPrompt, aspectRatio, seconds), mimeType: 'image/svg+xml' },
    });
  }
}

/** Recovers the art prompt from a mock keyframe URL so the clip is the same picture, moving. */
function promptOfMockKeyframe(url: string): string | null {
  if (!url.startsWith(MOCK_KEYFRAME_PATH)) return null;
  return new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('p');
}
