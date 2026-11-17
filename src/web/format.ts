import { assertNever } from '../domain/assert-never.js';
import type { GenerationState } from '../domain/shot.js';

export type StatusTone = 'neutral' | 'active' | 'success' | 'danger';

export interface StatusView {
  readonly label: string;
  readonly tone: StatusTone;
  /** 0 to 1 when a progress bar makes sense. */
  readonly progress: number | null;
}

/** How a generation state is worded and toned in the UI. */
export function describeGeneration(state: GenerationState): StatusView {
  switch (state.status) {
    case 'idle':
      return { label: 'Not generated', tone: 'neutral', progress: null };
    case 'queued':
      return { label: 'Queued', tone: 'active', progress: 0 };
    case 'generating':
      return {
        label: `${state.stage === 'keyframe' ? 'Keyframe' : 'Clip'} ${Math.round(state.progress * 100)}%`,
        tone: 'active',
        progress: state.progress,
      };
    case 'done':
      return { label: state.mode === 'video' ? 'Clip ready' : 'Keyframe ready', tone: 'success', progress: null };
    case 'failed':
      return { label: 'Failed', tone: 'danger', progress: null };
    default:
      return assertNever(state);
  }
}

export function humanize(value: string): string {
  return value.replace(/-/g, ' ');
}

export function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}
