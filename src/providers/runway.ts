import type RunwayML from '@runwayml/sdk';
import type { AspectRatio } from '../domain/shot.js';
import type { Sleeper } from './time.js';
import type { AnimateRequest, ImageProvider, VideoJob, VideoJobStatus, VideoProvider } from './types.js';

export const RUNWAY_VIDEO_MODELS = ['gen4.5', 'gen4_turbo'] as const;
export type RunwayVideoModel = (typeof RUNWAY_VIDEO_MODELS)[number];

const IMAGE_RATIOS = {
  '16:9': '1920:1080',
  '9:16': '1080:1920',
  '1:1': '1080:1080',
  '4:3': '1440:1080',
  '3:4': '1080:1440',
  '21:9': '2112:912',
} as const satisfies Record<AspectRatio, RunwayML.TextToImageCreateParams.Gen4Image['ratio']>;

const VIDEO_RATIOS = {
  '16:9': '1280:720',
  '9:16': '720:1280',
  '1:1': '960:960',
  '4:3': '1104:832',
  '3:4': '832:1104',
  '21:9': '1584:672',
} as const satisfies Record<AspectRatio, RunwayML.ImageToVideoCreateParams.Gen4_5['ratio']>;

const MIN_VIDEO_SECONDS = 2;
const MAX_VIDEO_SECONDS = 10;
const MAX_PROMPT_CHARS = 1000;

/** A Runway task reduced to what the adapters need. */
export type RunwayTask =
  | { readonly status: 'running'; readonly progress: number }
  | { readonly status: 'succeeded'; readonly outputUrls: readonly string[] }
  | { readonly status: 'failed'; readonly reason: string };

/** The three Runway calls the adapters use. Keeps the adapters thin and testable without the network. */
export interface RunwayApi {
  startImage(prompt: string, aspectRatio: AspectRatio): Promise<string>;
  startVideo(request: AnimateRequest, model: RunwayVideoModel): Promise<string>;
  getTask(taskId: string): Promise<RunwayTask>;
}

/** `RunwayApi` over `@runwayml/sdk`. */
export class RunwaySdkApi implements RunwayApi {
  constructor(private readonly client: RunwayML) {}

  public async startImage(prompt: string, aspectRatio: AspectRatio): Promise<string> {
    const task = await this.client.textToImage.create({
      model: 'gen4_image',
      promptText: prompt.slice(0, MAX_PROMPT_CHARS),
      ratio: IMAGE_RATIOS[aspectRatio],
    });
    return task.id;
  }

  public async startVideo(request: AnimateRequest, model: RunwayVideoModel): Promise<string> {
    const task = await this.client.imageToVideo.create({
      model,
      promptImage: request.imageUrl,
      promptText: request.prompt.slice(0, MAX_PROMPT_CHARS),
      ratio: VIDEO_RATIOS[request.aspectRatio],
      duration: Math.min(MAX_VIDEO_SECONDS, Math.max(MIN_VIDEO_SECONDS, request.seconds)),
    });
    return task.id;
  }

  public async getTask(taskId: string): Promise<RunwayTask> {
    const task = await this.client.tasks.retrieve(taskId);
    switch (task.status) {
      case 'SUCCEEDED':
        return { status: 'succeeded', outputUrls: task.output };
      case 'FAILED':
        return { status: 'failed', reason: task.failure };
      case 'CANCELLED':
        return { status: 'failed', reason: 'The task was cancelled.' };
      case 'RUNNING':
        return { status: 'running', progress: task.progress };
      case 'PENDING':
      case 'THROTTLED':
        return { status: 'running', progress: 0 };
    }
  }
}

export interface RunwayPolling {
  readonly intervalMs: number;
  readonly timeoutMs: number;
}

/** Runway text-to-image behind `ImageProvider`: start a task, wait for it, return the first output URL. */
export class RunwayImageProvider implements ImageProvider {
  constructor(
    private readonly api: RunwayApi,
    private readonly sleeper: Sleeper,
    private readonly polling: RunwayPolling,
  ) {}

  public async generate(prompt: string, aspectRatio: AspectRatio, signal?: AbortSignal): Promise<string> {
    const taskId = await this.api.startImage(prompt, aspectRatio);
    const maxPolls = Math.ceil(this.polling.timeoutMs / this.polling.intervalMs);
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const task = await this.api.getTask(taskId);
      if (task.status === 'succeeded') {
        const url = task.outputUrls[0];
        if (!url) throw new Error('Runway returned no image output.');
        return url;
      }
      if (task.status === 'failed') throw new Error(`Runway image generation failed: ${task.reason}`);
      await this.sleeper.sleep(this.polling.intervalMs, signal);
    }
    throw new Error('Runway image generation timed out.');
  }
}

/** Runway image-to-video behind `VideoProvider`. The caller owns the polling cadence. */
export class RunwayVideoProvider implements VideoProvider {
  constructor(
    private readonly api: RunwayApi,
    private readonly model: RunwayVideoModel,
  ) {}

  public async animate(request: AnimateRequest): Promise<VideoJob> {
    return { id: await this.api.startVideo(request, this.model) };
  }

  public async poll(job: VideoJob): Promise<VideoJobStatus> {
    const task = await this.api.getTask(job.id);
    switch (task.status) {
      case 'running':
        return { status: 'running', progress: task.progress };
      case 'failed':
        return { status: 'failed', error: task.reason };
      case 'succeeded': {
        const url = task.outputUrls[0];
        return url
          ? { status: 'succeeded', clip: { url, mimeType: 'video/mp4' } }
          : { status: 'failed', error: 'Runway returned no video output.' };
      }
    }
  }
}
