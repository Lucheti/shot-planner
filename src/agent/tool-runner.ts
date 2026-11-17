import { describeToolError } from '../domain/errors.js';
import { applyToolCall } from '../domain/reducer.js';
import type { GenerationMode } from '../domain/shot.js';
import { describeStoryboard, type Storyboard } from '../domain/storyboard.js';
import { summarizeToolCall } from './tool-summary.js';
import type { ToolDefinition } from './tools.js';

/** A render the agent asked for; the client starts it through `/api/generate`. */
export interface GenerationRequest {
  readonly shotId: string;
  readonly mode: GenerationMode;
}

export type ToolRunResult =
  | {
      readonly ok: true;
      readonly board: Storyboard;
      /** Shown to the user as an inline action. */
      readonly summary: string;
      /** Sent back to the model as the `tool_result` content. */
      readonly modelMessage: string;
      readonly generation: GenerationRequest | null;
    }
  | { readonly ok: false; readonly summary: string; readonly modelMessage: string };

/** The tools offered to the model, looked up by name. */
export class ToolRegistry {
  private readonly byName: ReadonlyMap<string, ToolDefinition>;

  constructor(private readonly definitions: readonly ToolDefinition[]) {
    this.byName = new Map(definitions.map((definition) => [definition.name, definition]));
  }

  /** Every definition, in presentation order. */
  public list(): readonly ToolDefinition[] {
    return this.definitions;
  }

  /** The definition for a tool name the model produced, if there is one. */
  public find(name: string): ToolDefinition | undefined {
    return this.byName.get(name);
  }
}

/** Parses a model-produced tool call, applies it through the reducer, and words the outcome for both audiences. */
export class ToolRunner {
  constructor(private readonly registry: ToolRegistry) {}

  /** Runs one tool call against `board`. Never throws: every failure becomes a result the model can read. */
  public run(name: string, input: unknown, board: Storyboard): ToolRunResult {
    const definition = this.registry.find(name);
    if (!definition) return failure(`Unknown tool "${name}"`, `Unknown tool "${name}". Available tools: ${this.toolNames()}.`);

    const parsed = definition.parse(input);
    if (!parsed.ok) return failure(`Rejected ${name}: invalid input`, `Invalid input for ${name}:\n${parsed.error}`);

    const applied = applyToolCall(board, parsed.value);
    if (!applied.ok) {
      const reason = describeToolError(applied.error);
      return failure(`Could not apply ${name}: ${reason}`, reason);
    }

    const call = parsed.value;
    const summary = summarizeToolCall(board, call, applied.value);
    return {
      ok: true,
      board: applied.value,
      summary,
      modelMessage: `${summary}.\n\n${describeStoryboard(applied.value)}`,
      generation: call.tool === 'generate_shot' ? { shotId: call.shotId, mode: call.mode } : null,
    };
  }

  private toolNames(): string {
    return this.registry
      .list()
      .map((definition) => definition.name)
      .join(', ');
  }
}

function failure(summary: string, modelMessage: string): ToolRunResult {
  return { ok: false, summary, modelMessage };
}
