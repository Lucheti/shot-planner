import type { GenerationEvent } from '../domain/generation.js';
import type { AspectRatio, GenerationMode, GenerationState, Shot } from '../domain/shot.js';
import type { ImageProvider, VideoProvider } from '../providers/types.js';
import type { Sleeper } from '../providers/time.js';

export interface GenerationJob {
  readonly shot: Shot;
  readonly aspectRatio: AspectRatio;
  readonly mode: GenerationMode;
}

export interface GenerationPolling {
  readonly intervalMs: number;
  readonly timeoutMs: number;
}

/** The motion prompt for image-to-video: the keyframe prompt plus the planned camera move. */
export function motionPrompt(shot: Shot): string {
  return `${shot.prompt} Camera: ${shot.cameraMove.replace(/-/g, ' ')}.`;
}

/**
 * Renders one shot. mode "image" makes a keyframe; mode "video" makes the keyframe first when the
 * shot has none, then animates it and polls the job. Failures become a `failed` state, never an exception.
 */
export class GenerationService {
  constructor(
    private readonly image: ImageProvider,
    private readonly video: VideoProvider,
    private readonly sleeper: Sleeper,
    private readonly polling: GenerationPolling,
  ) {}

  public async *run(job: GenerationJob, signal: AbortSignal): AsyncGenerator<GenerationEvent> {
    const { shot, aspectRatio, mode } = job;
    const state = (generation: GenerationState): GenerationEvent => ({
      type: 'generation_state',
      shotId: shot.id,
      generation,
    });
    const generating = (stage: 'keyframe' | 'clip', progress: number): GenerationEvent =>
      state({ status: 'generating', mode, stage, progress });

    try {
      let keyframe = shot.keyframeUrl;
      if (mode === 'image' || keyframe === null) {
        yield generating('keyframe', 0.1);
        keyframe = await this.image.generate(shot.prompt, aspectRatio, signal);
        yield { type: 'keyframe_ready', shotId: shot.id, url: keyframe };
        if (mode === 'image') {
          yield state({ status: 'done', mode });
          return;
        }
      }

      yield generating('clip', 0);
      const videoJob = await this.video.animate({
        imageUrl: keyframe,
        prompt: motionPrompt(shot),
        seconds: shot.durationSeconds,
        aspectRatio,
        signal,
      });

      const maxPolls = Math.ceil(this.polling.timeoutMs / this.polling.intervalMs);
      for (let poll = 0; poll < maxPolls; poll += 1) {
        const status = await this.video.poll(videoJob, signal);
        if (status.status === 'succeeded') {
          yield { type: 'clip_ready', shotId: shot.id, clip: status.clip };
          yield state({ status: 'done', mode });
          return;
        }
        if (status.status === 'failed') {
          yield state({ status: 'failed', mode, error: status.error });
          return;
        }
        yield generating('clip', status.progress);
        await this.sleeper.sleep(this.polling.intervalMs, signal);
      }
      yield state({ status: 'failed', mode, error: 'Timed out waiting for the video.' });
    } catch (error) {
      if (signal.aborted) return;
      yield state({ status: 'failed', mode, error: error instanceof Error ? error.message : 'Generation failed.' });
    }
  }
}
