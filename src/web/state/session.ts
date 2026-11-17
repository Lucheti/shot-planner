import { mergeAgentBoard } from '../../domain/generation.js';
import { assertNever } from '../../domain/assert-never.js';
import type { Storyboard } from '../../domain/storyboard.js';
import type { AgentEvent, AppInfo, FinishReason } from '../../protocol/messages.js';

export type ActionStatus = 'running' | 'ok' | 'error';

/** A piece of an assistant message: streamed prose, an inline tool action, or a notice. */
export type AssistantPart =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'action';
      readonly callId: string;
      readonly tool: string;
      readonly status: ActionStatus;
      readonly summary: string;
    }
  | { readonly kind: 'notice'; readonly text: string };

export type TranscriptEntry =
  | { readonly id: string; readonly role: 'user'; readonly text: string }
  | { readonly id: string; readonly role: 'assistant'; readonly parts: readonly AssistantPart[]; readonly done: boolean };

/** Everything the UI renders from. Pure data: the reducer below is its only writer for agent events. */
export interface Session {
  readonly info: AppInfo | null;
  readonly board: Storyboard;
  readonly transcript: readonly TranscriptEntry[];
  readonly chatRunning: boolean;
  readonly error: string | null;
}

const FINISH_NOTICES: Readonly<Record<FinishReason, string | null>> = {
  end_turn: null,
  cancelled: 'Stopped.',
  step_limit: 'Stopped after reaching the step limit.',
  max_tokens: 'The reply was cut short by the output limit.',
  refusal: 'The model declined to continue.',
};

function updateLastAssistant(
  transcript: readonly TranscriptEntry[],
  change: (parts: readonly AssistantPart[], done: boolean) => { parts: readonly AssistantPart[]; done: boolean },
): TranscriptEntry[] {
  const index = transcript.findLastIndex((entry) => entry.role === 'assistant');
  const last = transcript[index];
  if (!last || last.role !== 'assistant') return [...transcript];
  const next = change(last.parts, last.done);
  return transcript.map((entry, i) => (i === index ? { ...last, ...next } : entry));
}

/** Folds one agent event into the session. Pure. */
export function applyAgentEvent(session: Session, event: AgentEvent): Session {
  switch (event.type) {
    case 'text_delta':
      return {
        ...session,
        transcript: updateLastAssistant(session.transcript, (parts, done) => {
          const last = parts.at(-1);
          const next: AssistantPart[] =
            last?.kind === 'text'
              ? [...parts.slice(0, -1), { kind: 'text', text: last.text + event.text }]
              : [...parts, { kind: 'text', text: event.text }];
          return { parts: next, done };
        }),
      };
    case 'tool_started':
      return {
        ...session,
        transcript: updateLastAssistant(session.transcript, (parts, done) => ({
          parts: [
            ...parts,
            { kind: 'action', callId: event.callId, tool: event.tool, status: 'running', summary: `Running ${event.tool}…` },
          ],
          done,
        })),
      };
    case 'tool_finished':
      return {
        ...session,
        transcript: updateLastAssistant(session.transcript, (parts, done) => ({
          parts: parts.map((part) =>
            part.kind === 'action' && part.callId === event.callId
              ? { ...part, status: event.ok ? 'ok' : 'error', summary: event.summary }
              : part,
          ),
          done,
        })),
      };
    case 'board':
      return { ...session, board: mergeAgentBoard(session.board, event.board) };
    case 'generation_requested':
      return session;
    case 'finished': {
      const notice = FINISH_NOTICES[event.reason];
      return {
        ...session,
        transcript: updateLastAssistant(session.transcript, (parts) => ({
          parts: notice ? [...parts, { kind: 'notice', text: notice }] : parts,
          done: true,
        })),
      };
    }
    case 'failed':
      return {
        ...session,
        error: event.message,
        transcript: updateLastAssistant(session.transcript, (parts) => ({ parts, done: true })),
      };
    default:
      return assertNever(event);
  }
}

/** The text of an assistant entry, as it is replayed to the model on later turns. */
export function assistantText(entry: Extract<TranscriptEntry, { role: 'assistant' }>): string {
  return entry.parts
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('')
    .trim();
}
