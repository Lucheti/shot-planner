import type { AspectRatio, Clip } from '../domain/shot.js';

/** Turns a prompt into a still keyframe and returns its URL. */
export interface ImageProvider {
  generate(prompt: string, aspectRatio: AspectRatio, signal?: AbortSignal): Promise<string>;
}

export interface AnimateRequest {
  readonly imageUrl: string;
  readonly prompt: string;
  readonly seconds: number;
  readonly aspectRatio: AspectRatio;
  readonly signal?: AbortSignal;
}

/** A started video generation; poll it until it is done. */
export interface VideoJob {
  readonly id: string;
}

export type VideoJobStatus =
  | { readonly status: 'running'; readonly progress: number }
  | { readonly status: 'succeeded'; readonly clip: Clip }
  | { readonly status: 'failed'; readonly error: string };

/** Animates a keyframe into a short clip as an asynchronous job. */
export interface VideoProvider {
  animate(request: AnimateRequest): Promise<VideoJob>;
  poll(job: VideoJob, signal?: AbortSignal): Promise<VideoJobStatus>;
}
