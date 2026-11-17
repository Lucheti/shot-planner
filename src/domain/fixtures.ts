import { applyToolCall } from './reducer.js';
import type { ShotDraft } from './shot.js';
import { emptyStoryboard, type Storyboard } from './storyboard.js';

/** Test helper: a valid shot draft with optional overrides. */
export function draft(overrides: Partial<ShotDraft> = {}): ShotDraft {
  return {
    durationSeconds: 4,
    framing: 'wide',
    cameraMove: 'static',
    description: 'A potter opens the studio shutters at dawn.',
    prompt: 'Ceramic studio at dawn, warm light through shutters, 35mm',
    ...overrides,
  };
}

/** Test helper: a board built through the real reducer with `count` shots (ids shot_1..shot_n). */
export function boardWithShots(count: number): Storyboard {
  const shots = Array.from({ length: count }, (_, i) => draft({ description: `Shot ${i + 1}` }));
  const result = applyToolCall(emptyStoryboard(), {
    tool: 'create_storyboard',
    title: 'Ceramic studio teaser',
    aspectRatio: '16:9',
    shots,
  });
  if (!result.ok) throw new Error(`fixture failed: ${result.error.code}`);
  return result.value;
}
