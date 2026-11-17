import { assertNever } from './assert-never.js';
import type { Clip, GenerationState, Shot } from './shot.js';
import type { Storyboard } from './storyboard.js';

/** What a generation run reports about one shot. */
export type GenerationEvent =
  | { readonly type: 'generation_state'; readonly shotId: string; readonly generation: GenerationState }
  | { readonly type: 'keyframe_ready'; readonly shotId: string; readonly url: string }
  | { readonly type: 'clip_ready'; readonly shotId: string; readonly clip: Clip };

function mapShot(board: Storyboard, shotId: string, change: (shot: Shot) => Shot): Storyboard {
  if (!board.shots.some((shot) => shot.id === shotId)) return board;
  return { ...board, shots: board.shots.map((shot) => (shot.id === shotId ? change(shot) : shot)) };
}

/** Pure reducer for generation progress. Events for shots that no longer exist are ignored. */
export function applyGenerationEvent(board: Storyboard, event: GenerationEvent): Storyboard {
  switch (event.type) {
    case 'generation_state':
      return mapShot(board, event.shotId, (shot) => ({ ...shot, generation: event.generation }));
    case 'keyframe_ready':
      return mapShot(board, event.shotId, (shot) => ({ ...shot, keyframeUrl: event.url, clip: null }));
    case 'clip_ready':
      return mapShot(board, event.shotId, (shot) => ({ ...shot, clip: event.clip }));
    default:
      return assertNever(event);
  }
}

/**
 * Adopts a board snapshot streamed by the agent while keeping what the generation channel
 * owns locally (state, keyframe, clip), so an in-flight render is never overwritten by a stale snapshot.
 */
export function mergeAgentBoard(local: Storyboard, incoming: Storyboard): Storyboard {
  const localById = new Map(local.shots.map((shot) => [shot.id, shot]));
  const shots = incoming.shots.map((shot) => {
    const existing = localById.get(shot.id);
    return existing
      ? { ...shot, generation: existing.generation, keyframeUrl: existing.keyframeUrl, clip: existing.clip }
      : shot;
  });
  return { ...incoming, shots };
}
