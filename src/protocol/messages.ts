import { z } from 'zod';
import { type GenerationEvent } from '../domain/generation.js';
import { generationModeSchema, storyboardSchema } from '../domain/schema.js';
import type { GenerationMode } from '../domain/shot.js';
import type { Storyboard } from '../domain/storyboard.js';

export type FinishReason = 'end_turn' | 'step_limit' | 'cancelled' | 'max_tokens' | 'refusal';

/** Everything the agent loop tells the client while it works, in order. */
export type AgentEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'tool_started'; readonly callId: string; readonly tool: string }
  | {
      readonly type: 'tool_finished';
      readonly callId: string;
      readonly tool: string;
      readonly ok: boolean;
      readonly summary: string;
    }
  | { readonly type: 'board'; readonly board: Storyboard }
  | { readonly type: 'generation_requested'; readonly shotId: string; readonly mode: GenerationMode }
  | { readonly type: 'finished'; readonly reason: FinishReason }
  | { readonly type: 'failed'; readonly message: string };

/** What `/api/generate` streams: generation events, or a stream-level failure. */
export type GenerateStreamMessage =
  | GenerationEvent
  | { readonly type: 'stream_error'; readonly message: string };

export interface AppInfo {
  readonly planner: 'claude' | 'mock';
  readonly providers: 'runway' | 'mock';
  readonly model: string | null;
}

export const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .min(1)
    .refine((messages) => messages[messages.length - 1]?.role === 'user', 'The last message must be from the user.'),
  board: storyboardSchema,
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatMessage = ChatRequest['messages'][number];

export const generateRequestSchema = z.object({
  board: storyboardSchema,
  shotId: z.string().min(1),
  mode: generationModeSchema,
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

const generationStateSchema = storyboardSchema.shape.shots.element.shape.generation;
const clipSchema = z.object({ url: z.string(), mimeType: z.string() });

export const agentEventSchema: z.ZodType<AgentEvent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  z.object({ type: z.literal('tool_started'), callId: z.string(), tool: z.string() }),
  z.object({
    type: z.literal('tool_finished'),
    callId: z.string(),
    tool: z.string(),
    ok: z.boolean(),
    summary: z.string(),
  }),
  z.object({ type: z.literal('board'), board: storyboardSchema }),
  z.object({ type: z.literal('generation_requested'), shotId: z.string(), mode: generationModeSchema }),
  z.object({
    type: z.literal('finished'),
    reason: z.enum(['end_turn', 'step_limit', 'cancelled', 'max_tokens', 'refusal']),
  }),
  z.object({ type: z.literal('failed'), message: z.string() }),
]);

export const generateStreamMessageSchema: z.ZodType<GenerateStreamMessage> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('generation_state'), shotId: z.string(), generation: generationStateSchema }),
  z.object({ type: z.literal('keyframe_ready'), shotId: z.string(), url: z.string() }),
  z.object({ type: z.literal('clip_ready'), shotId: z.string(), clip: clipSchema }),
  z.object({ type: z.literal('stream_error'), message: z.string() }),
]);
