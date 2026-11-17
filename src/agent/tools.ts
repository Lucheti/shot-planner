import { z } from 'zod';
import { err, ok, type Result } from '../domain/result.js';
import {
  aspectRatioSchema,
  generationModeSchema,
  shotDraftSchema,
} from '../domain/schema.js';
import type { ToolCall, ToolName } from '../domain/tool-call.js';

export type JsonSchemaObject = { readonly type: 'object' } & Readonly<Record<string, unknown>>;

/** One tool the model may call: its contract for the model and its parser into a domain `ToolCall`. */
export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  inputSchema(): JsonSchemaObject;
  parse(input: unknown): Result<ToolCall, string>;
}

class ZodTool<N extends ToolName, S extends z.ZodType> implements ToolDefinition {
  constructor(
    public readonly name: N,
    public readonly description: string,
    private readonly schema: S,
    private readonly build: (input: z.output<S>) => Extract<ToolCall, { tool: N }>,
  ) {}

  public inputSchema(): JsonSchemaObject {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(this.schema, { io: 'input' }) as Record<string, unknown>;
    return { ...schema, type: 'object' };
  }

  public parse(input: unknown): Result<ToolCall, string> {
    const parsed = this.schema.safeParse(input);
    return parsed.success ? ok(this.build(parsed.data)) : err(z.prettifyError(parsed.error));
  }
}

const shotId = z.string().min(1).describe('The id of the shot (for example "shot_2"), not its position.');

/** The six tools of the agent, in the order they are offered to the model. */
export function createToolDefinitions(): readonly ToolDefinition[] {
  return [
    new ZodTool(
      'create_storyboard',
      'Create (or replace) the storyboard with a title, an aspect ratio and the full shot list. Use this for the first proposal and when the user wants to start over.',
      z.object({
        title: z.string().min(1).describe('A short working title.'),
        aspectRatio: aspectRatioSchema,
        shots: z.array(shotDraftSchema).min(1).max(12),
      }),
      (input) => ({ tool: 'create_storyboard', ...input }),
    ),
    new ZodTool(
      'update_shot',
      'Change fields of one existing shot. Only send the fields that change.',
      z.object({
        shotId,
        patch: shotDraftSchema.partial().describe('The fields to change.'),
      }),
      (input) => ({ tool: 'update_shot', shotId: input.shotId, patch: input.patch }),
    ),
    new ZodTool(
      'add_shot',
      'Insert a new shot after an existing one, or at the end when afterShotId is omitted.',
      z.object({
        afterShotId: shotId.optional().describe('Insert after this shot. Omit to append at the end.'),
        shot: shotDraftSchema,
      }),
      (input) => ({ tool: 'add_shot', afterShotId: input.afterShotId ?? null, shot: input.shot }),
    ),
    new ZodTool(
      'remove_shot',
      'Delete one shot from the storyboard.',
      z.object({ shotId }),
      (input) => ({ tool: 'remove_shot', shotId: input.shotId }),
    ),
    new ZodTool(
      'reorder_shots',
      'Set a new order. `order` must list every existing shot id exactly once.',
      z.object({ order: z.array(z.string().min(1)).min(1) }),
      (input) => ({ tool: 'reorder_shots', order: input.order }),
    ),
    new ZodTool(
      'generate_shot',
      'Render one shot. mode "image" generates the keyframe; mode "video" generates the keyframe if missing and then animates it into a short clip. Only call this when the user asks to generate.',
      z.object({ shotId, mode: generationModeSchema }),
      (input) => ({ tool: 'generate_shot', shotId: input.shotId, mode: input.mode }),
    ),
  ];
}
