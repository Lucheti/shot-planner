import type { AspectRatio, Shot } from './shot.js';

/** The board: the single source of truth for the plan. Position in `shots` is the shot number. */
export interface Storyboard {
  readonly title: string;
  readonly aspectRatio: AspectRatio;
  readonly shots: readonly Shot[];
  readonly nextShotSeq: number;
}

/** A board with no shots, before the agent has proposed anything. */
export function emptyStoryboard(): Storyboard {
  return { title: '', aspectRatio: '16:9', shots: [], nextShotSeq: 1 };
}

/** True when there is nothing on the board yet. */
export function isEmpty(board: Storyboard): boolean {
  return board.shots.length === 0;
}

/** Sum of every shot's duration in seconds. */
export function totalSeconds(board: Storyboard): number {
  return board.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
}

/** The 1-based shot number for an id, or null. */
export function shotNumber(board: Storyboard, shotId: string): number | null {
  const index = board.shots.findIndex((shot) => shot.id === shotId);
  return index === -1 ? null : index + 1;
}

/** Looks a shot up by id. */
export function findShot(board: Storyboard, shotId: string): Shot | undefined {
  return board.shots.find((shot) => shot.id === shotId);
}

/** A plain-text rendering of the plan (without media) for prompts and tool results. */
export function describeStoryboard(board: Storyboard): string {
  if (isEmpty(board)) return 'The storyboard is empty.';
  const header = `Storyboard "${board.title}" (${board.aspectRatio}, ${totalSeconds(board)}s total, ${board.shots.length} shots)`;
  const lines = board.shots.map((shot, index) => {
    const media = shot.keyframeUrl ? ' [keyframe generated]' : '';
    return `#${index + 1} id=${shot.id} ${shot.durationSeconds}s ${shot.framing} / ${shot.cameraMove}${media}\n   description: ${shot.description}\n   prompt: ${shot.prompt}`;
  });
  return [header, ...lines].join('\n');
}
