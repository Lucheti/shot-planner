import { assertNever } from './assert-never.js';

/** Maximum number of shots a storyboard may hold. */
export const MAX_SHOTS = 12;

/** Every way a tool call can be refused by the reducer. */
export type ToolError =
  | { readonly code: 'NO_STORYBOARD' }
  | { readonly code: 'NO_SHOTS' }
  | { readonly code: 'TOO_MANY_SHOTS'; readonly max: number }
  | { readonly code: 'SHOT_NOT_FOUND'; readonly shotId: string; readonly knownShotIds: readonly string[] }
  | { readonly code: 'INVALID_DURATION'; readonly seconds: number }
  | { readonly code: 'EMPTY_PATCH' }
  | {
      readonly code: 'INVALID_ORDER';
      readonly expected: readonly string[];
      readonly received: readonly string[];
    };

/** Renders a tool error as an actionable message the model can recover from. */
export function describeToolError(error: ToolError): string {
  switch (error.code) {
    case 'NO_STORYBOARD':
      return 'There is no storyboard yet. Call create_storyboard first.';
    case 'NO_SHOTS':
      return 'A storyboard needs at least one shot.';
    case 'TOO_MANY_SHOTS':
      return `A storyboard holds at most ${error.max} shots.`;
    case 'SHOT_NOT_FOUND':
      return `No shot with id "${error.shotId}". Known shot ids: ${error.knownShotIds.join(', ') || 'none'}.`;
    case 'INVALID_DURATION':
      return `Shot duration must be a whole number of seconds between 1 and 10 (got ${error.seconds}).`;
    case 'EMPTY_PATCH':
      return 'The patch changes nothing. Provide at least one field to update.';
    case 'INVALID_ORDER':
      return `order must list every shot id exactly once. Expected: ${error.expected.join(', ')}. Received: ${error.received.join(', ')}.`;
    default:
      return assertNever(error);
  }
}
