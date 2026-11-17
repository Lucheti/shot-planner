import { z } from 'zod';
import { Duration } from './duration.js';
import { MAX_SHOTS } from './errors.js';
import { ASPECT_RATIOS, CAMERA_MOVES, FRAMINGS } from './shot.js';

export const aspectRatioSchema = z.enum(ASPECT_RATIOS);
export const framingSchema = z.enum(FRAMINGS);
export const cameraMoveSchema = z.enum(CAMERA_MOVES);
export const generationModeSchema = z.enum(['image', 'video']);

export const durationSecondsSchema = z
  .number()
  .int()
  .min(Duration.MIN_SECONDS)
  .max(Duration.MAX_SECONDS)
  .describe(`Whole seconds, ${Duration.MIN_SECONDS} to ${Duration.MAX_SECONDS}.`);

export const shotDraftSchema = z.object({
  durationSeconds: durationSecondsSchema,
  framing: framingSchema,
  cameraMove: cameraMoveSchema,
  description: z.string().min(1).describe('One or two sentences: what the viewer sees and why it matters.'),
  prompt: z
    .string()
    .min(1)
    .max(900)
    .describe('The text-to-image prompt for the keyframe: subject, setting, light, lens, mood. Self-contained.'),
});

const generationStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({ status: z.literal('queued'), mode: generationModeSchema }),
  z.object({
    status: z.literal('generating'),
    mode: generationModeSchema,
    stage: z.enum(['keyframe', 'clip']),
    progress: z.number().min(0).max(1),
  }),
  z.object({ status: z.literal('done'), mode: generationModeSchema }),
  z.object({ status: z.literal('failed'), mode: generationModeSchema, error: z.string() }),
]);

export const shotSchema = shotDraftSchema.extend({
  id: z.string().min(1),
  keyframeUrl: z.string().nullable(),
  clip: z.object({ url: z.string(), mimeType: z.string() }).nullable(),
  generation: generationStateSchema,
});

/** Validates a storyboard received over the wire (the client owns the board between requests). */
export const storyboardSchema = z.object({
  title: z.string(),
  aspectRatio: aspectRatioSchema,
  shots: z.array(shotSchema).max(MAX_SHOTS),
  nextShotSeq: z.number().int().min(1),
});
