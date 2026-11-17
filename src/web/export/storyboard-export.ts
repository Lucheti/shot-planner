import { totalSeconds, type Storyboard } from '../../domain/storyboard.js';

export const EXPORT_FORMAT = 'shot-planner/storyboard@1';

/** The storyboard as a stable, readable JSON document: plan fields plus the generated media URLs. */
export function storyboardToJson(board: Storyboard): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      title: board.title,
      aspectRatio: board.aspectRatio,
      totalSeconds: totalSeconds(board),
      shots: board.shots.map((shot, index) => ({
        number: index + 1,
        id: shot.id,
        durationSeconds: shot.durationSeconds,
        framing: shot.framing,
        cameraMove: shot.cameraMove,
        description: shot.description,
        prompt: shot.prompt,
        keyframeUrl: shot.keyframeUrl,
        clipUrl: shot.clip?.url ?? null,
      })),
    },
    null,
    2,
  );
}

/** A file-system friendly name for the export. */
export function exportFilename(board: Storyboard, extension: string): string {
  const slug = board.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'storyboard'}.${extension}`;
}
