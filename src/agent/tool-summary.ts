import { assertNever } from '../domain/assert-never.js';
import type { Shot, ShotPatch } from '../domain/shot.js';
import { shotNumber, totalSeconds, type Storyboard } from '../domain/storyboard.js';
import type { ToolCall } from '../domain/tool-call.js';

const LONG_TEXT_FIELDS = new Set<keyof ShotPatch>(['description', 'prompt']);

function describeChange(field: keyof ShotPatch, shot: Shot): string {
  if (LONG_TEXT_FIELDS.has(field)) return `${field} rewritten`;
  if (field === 'durationSeconds') return `duration → ${shot.durationSeconds}s`;
  return `${field} → ${shot[field]}`;
}

/** A one-line, human-readable account of an applied tool call, shown as an inline action in the chat. */
export function summarizeToolCall(before: Storyboard, call: ToolCall, after: Storyboard): string {
  switch (call.tool) {
    case 'create_storyboard':
      return `Created "${after.title}": ${after.shots.length} shots, ${totalSeconds(after)}s, ${after.aspectRatio}`;
    case 'update_shot': {
      const number = shotNumber(after, call.shotId);
      const shot = after.shots.find((s) => s.id === call.shotId);
      const fields = (Object.keys(call.patch) as (keyof ShotPatch)[]).filter((f) => call.patch[f] !== undefined);
      const changes = shot ? fields.map((field) => describeChange(field, shot)).join(', ') : '';
      return `Updated shot ${number}: ${changes}`;
    }
    case 'add_shot': {
      const knownBefore = new Set(before.shots.map((s) => s.id));
      const index = after.shots.findIndex((s) => !knownBefore.has(s.id));
      const shot = after.shots[index];
      return `Added shot ${index + 1}${shot ? ` (${shot.framing}, ${shot.durationSeconds}s)` : ''}`;
    }
    case 'remove_shot':
      return `Removed shot ${shotNumber(before, call.shotId)}`;
    case 'reorder_shots':
      return `Reordered shots: ${call.order.map((id) => shotNumber(before, id)).join(' → ')}`;
    case 'generate_shot':
      return `Queued ${call.mode === 'image' ? 'keyframe' : 'video clip'} for shot ${shotNumber(after, call.shotId)}`;
    default:
      return assertNever(call);
  }
}
