import type { AspectRatio, GenerationMode, ShotDraft, ShotPatch } from './shot.js';

/** A validated request from the agent to change the board. */
export type ToolCall =
  | {
      readonly tool: 'create_storyboard';
      readonly title: string;
      readonly aspectRatio: AspectRatio;
      readonly shots: readonly ShotDraft[];
    }
  | { readonly tool: 'update_shot'; readonly shotId: string; readonly patch: ShotPatch }
  | { readonly tool: 'add_shot'; readonly afterShotId: string | null; readonly shot: ShotDraft }
  | { readonly tool: 'remove_shot'; readonly shotId: string }
  | { readonly tool: 'reorder_shots'; readonly order: readonly string[] }
  | { readonly tool: 'generate_shot'; readonly shotId: string; readonly mode: GenerationMode };

export type ToolName = ToolCall['tool'];
