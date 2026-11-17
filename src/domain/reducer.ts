import { assertNever } from './assert-never.js';
import { Duration } from './duration.js';
import { MAX_SHOTS, type ToolError } from './errors.js';
import { err, ok, type Result } from './result.js';
import { IDLE, type Shot, type ShotDraft, type ShotPatch } from './shot.js';
import { findShot, isEmpty, type Storyboard } from './storyboard.js';
import type { ToolCall } from './tool-call.js';

type Outcome = Result<Storyboard, ToolError>;

/**
 * The pure heart of the app: applies one tool call to a board.
 * Never mutates; returns the next board or a typed error that is fed back to the model.
 */
export function applyToolCall(board: Storyboard, call: ToolCall): Outcome {
  switch (call.tool) {
    case 'create_storyboard':
      return createStoryboard(board, call);
    case 'update_shot':
      return updateShot(board, call.shotId, call.patch);
    case 'add_shot':
      return addShot(board, call.afterShotId, call.shot);
    case 'remove_shot':
      return removeShot(board, call.shotId);
    case 'reorder_shots':
      return reorderShots(board, call.order);
    case 'generate_shot': {
      const found = requireShot(board, call.shotId);
      return found.ok ? ok(board) : found;
    }
    default:
      return assertNever(call);
  }
}

function newShot(id: string, draft: ShotDraft): Result<Shot, ToolError> {
  const duration = Duration.of(draft.durationSeconds);
  if (!duration.ok) return duration;
  return ok({
    ...draft,
    id,
    durationSeconds: duration.value.seconds,
    keyframeUrl: null,
    clip: null,
    generation: IDLE,
  });
}

function createStoryboard(board: Storyboard, call: Extract<ToolCall, { tool: 'create_storyboard' }>): Outcome {
  if (call.shots.length === 0) return err({ code: 'NO_SHOTS' });
  if (call.shots.length > MAX_SHOTS) return err({ code: 'TOO_MANY_SHOTS', max: MAX_SHOTS });
  const shots: Shot[] = [];
  let seq = board.nextShotSeq;
  for (const draft of call.shots) {
    const shot = newShot(`shot_${seq}`, draft);
    if (!shot.ok) return shot;
    shots.push(shot.value);
    seq += 1;
  }
  return ok({ title: call.title, aspectRatio: call.aspectRatio, shots, nextShotSeq: seq });
}

function requireShot(board: Storyboard, shotId: string): Result<Shot, ToolError> {
  if (isEmpty(board)) return err({ code: 'NO_STORYBOARD' });
  const shot = findShot(board, shotId);
  return shot
    ? ok(shot)
    : err({ code: 'SHOT_NOT_FOUND', shotId, knownShotIds: board.shots.map((s) => s.id) });
}

function updateShot(board: Storyboard, shotId: string, patch: ShotPatch): Outcome {
  const found = requireShot(board, shotId);
  if (!found.ok) return found;
  const defined = withoutUndefined(patch);
  if (Object.keys(defined).length === 0) return err({ code: 'EMPTY_PATCH' });
  if (defined.durationSeconds !== undefined) {
    const duration = Duration.of(defined.durationSeconds);
    if (!duration.ok) return duration;
  }
  const updated: Shot = { ...found.value, ...defined };
  return ok({ ...board, shots: board.shots.map((shot) => (shot.id === shotId ? updated : shot)) });
}

function withoutUndefined(patch: ShotPatch): ShotPatch {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as ShotPatch;
}

function addShot(board: Storyboard, afterShotId: string | null, draft: ShotDraft): Outcome {
  if (isEmpty(board)) return err({ code: 'NO_STORYBOARD' });
  if (board.shots.length >= MAX_SHOTS) return err({ code: 'TOO_MANY_SHOTS', max: MAX_SHOTS });
  const insertAt = afterShotId === null ? board.shots.length : board.shots.findIndex((s) => s.id === afterShotId) + 1;
  if (afterShotId !== null && insertAt === 0) {
    return err({ code: 'SHOT_NOT_FOUND', shotId: afterShotId, knownShotIds: board.shots.map((s) => s.id) });
  }
  const created = newShot(`shot_${board.nextShotSeq}`, draft);
  if (!created.ok) return created;
  const shots = [...board.shots.slice(0, insertAt), created.value, ...board.shots.slice(insertAt)];
  return ok({ ...board, shots, nextShotSeq: board.nextShotSeq + 1 });
}

function removeShot(board: Storyboard, shotId: string): Outcome {
  const found = requireShot(board, shotId);
  if (!found.ok) return found;
  return ok({ ...board, shots: board.shots.filter((shot) => shot.id !== shotId) });
}

function reorderShots(board: Storyboard, order: readonly string[]): Outcome {
  if (isEmpty(board)) return err({ code: 'NO_STORYBOARD' });
  const expected = board.shots.map((shot) => shot.id);
  const isPermutation =
    order.length === expected.length &&
    new Set(order).size === order.length &&
    expected.every((id) => order.includes(id));
  if (!isPermutation) return err({ code: 'INVALID_ORDER', expected, received: order });
  const byId = new Map(board.shots.map((shot) => [shot.id, shot]));
  const shots = order.map((id) => byId.get(id)).filter((shot): shot is Shot => shot !== undefined);
  return ok({ ...board, shots });
}
