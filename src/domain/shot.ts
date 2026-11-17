export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const FRAMINGS = [
  'extreme-wide',
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
  'over-the-shoulder',
  'overhead',
  'insert',
] as const;
export type Framing = (typeof FRAMINGS)[number];

export const CAMERA_MOVES = [
  'static',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'dolly-in',
  'dolly-out',
  'tracking',
  'handheld',
  'crane-up',
  'orbit',
  'zoom-in',
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export type GenerationMode = 'image' | 'video';
export type GenerationStage = 'keyframe' | 'clip';

/** Where a shot is in its generation lifecycle. */
export type GenerationState =
  | { readonly status: 'idle' }
  | { readonly status: 'queued'; readonly mode: GenerationMode }
  | {
      readonly status: 'generating';
      readonly mode: GenerationMode;
      readonly stage: GenerationStage;
      readonly progress: number;
    }
  | { readonly status: 'done'; readonly mode: GenerationMode }
  | { readonly status: 'failed'; readonly mode: GenerationMode; readonly error: string };

/** A generated video clip. `mimeType` tells the UI how to render it. */
export interface Clip {
  readonly url: string;
  readonly mimeType: string;
}

/** The creative fields of a shot, as the planner writes them. */
export interface ShotDraft {
  readonly durationSeconds: number;
  readonly framing: Framing;
  readonly cameraMove: CameraMove;
  readonly description: string;
  readonly prompt: string;
}

/** A partial edit to a shot's creative fields. */
export type ShotPatch = Partial<ShotDraft>;

/** One card of the storyboard. */
export interface Shot extends ShotDraft {
  readonly id: string;
  readonly keyframeUrl: string | null;
  readonly clip: Clip | null;
  readonly generation: GenerationState;
}

export const IDLE: GenerationState = { status: 'idle' };

/** True while a generation is queued or running. */
export function isGenerationInFlight(state: GenerationState): boolean {
  return state.status === 'queued' || state.status === 'generating';
}
