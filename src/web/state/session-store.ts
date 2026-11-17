import { createStore, type StoreApi } from 'zustand/vanilla';
import { applyGenerationEvent } from '../../domain/generation.js';
import { findShot, emptyStoryboard } from '../../domain/storyboard.js';
import { isGenerationInFlight, type GenerationMode, type GenerationState } from '../../domain/shot.js';
import type { ChatMessage } from '../../protocol/messages.js';
import type { ApiClient } from '../api/api-client.js';
import { applyAgentEvent, assistantText, type Session } from './session.js';

export interface SessionActions {
  loadInfo(): Promise<void>;
  send(text: string): Promise<void>;
  stop(): void;
  generate(shotId: string, mode: GenerationMode): Promise<void>;
  generateAll(mode: GenerationMode): Promise<void>;
  cancelGeneration(shotId: string): void;
  reset(): void;
  dismissError(): void;
}

export type SessionState = Session & SessionActions;
export type SessionStore = StoreApi<SessionState>;

export interface SessionStoreOptions {
  readonly api: ApiClient;
  readonly newId: () => string;
  /** How many renders "generate all" runs at once. */
  readonly renderConcurrency?: number;
}

const INITIAL: Session = {
  info: null,
  board: emptyStoryboard(),
  transcript: [],
  chatRunning: false,
  error: null,
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong.');

/** Builds the session store. All I/O goes through the injected `ApiClient`. */
export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const { api, newId, renderConcurrency = 2 } = options;
  let chatController: AbortController | null = null;
  const renderControllers = new Map<string, AbortController>();

  return createStore<SessionState>((set, get) => {
    const setGeneration = (shotId: string, generation: GenerationState): void =>
      set((s) => ({ board: applyGenerationEvent(s.board, { type: 'generation_state', shotId, generation }) }));

    const actions: SessionActions = {
      async loadInfo() {
        try {
          set({ info: await api.info() });
        } catch (error) {
          set({ error: messageOf(error) });
        }
      },

      async send(text) {
        const trimmed = text.trim();
        if (!trimmed || get().chatRunning) return;
        const history: ChatMessage[] = get().transcript.flatMap((entry): ChatMessage[] => {
          if (entry.role === 'user') return [{ role: 'user', content: entry.text }];
          const reply = assistantText(entry);
          return reply ? [{ role: 'assistant', content: reply }] : [];
        });
        const controller = new AbortController();
        chatController = controller;
        set((s) => ({
          chatRunning: true,
          error: null,
          transcript: [
            ...s.transcript,
            { id: newId(), role: 'user', text: trimmed },
            { id: newId(), role: 'assistant', parts: [], done: false },
          ],
        }));

        try {
          const request = { messages: [...history, { role: 'user' as const, content: trimmed }], board: get().board };
          for await (const event of api.chat(request, controller.signal)) {
            set((s) => applyAgentEvent(s, event));
            if (event.type === 'generation_requested') void actions.generate(event.shotId, event.mode);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            set((s) => applyAgentEvent(s, { type: 'failed', message: messageOf(error) }));
          }
        } finally {
          if (controller.signal.aborted) set((s) => applyAgentEvent(s, { type: 'finished', reason: 'cancelled' }));
          set({ chatRunning: false });
          if (chatController === controller) chatController = null;
        }
      },

      stop() {
        chatController?.abort();
      },

      async generate(shotId, mode) {
        const shot = findShot(get().board, shotId);
        if (!shot || isGenerationInFlight(shot.generation)) return;
        const controller = new AbortController();
        renderControllers.set(shotId, controller);
        setGeneration(shotId, { status: 'queued', mode });

        try {
          const request = { board: get().board, shotId, mode };
          for await (const message of api.generate(request, controller.signal)) {
            if (message.type === 'stream_error') {
              setGeneration(shotId, { status: 'failed', mode, error: message.message });
            } else {
              set((s) => ({ board: applyGenerationEvent(s.board, message) }));
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) setGeneration(shotId, { status: 'failed', mode, error: messageOf(error) });
        } finally {
          if (controller.signal.aborted) setGeneration(shotId, { status: 'idle' });
          renderControllers.delete(shotId);
        }
      },

      async generateAll(mode) {
        const queue = get()
          .board.shots.filter((shot) => !isGenerationInFlight(shot.generation))
          .map((shot) => shot.id);
        const worker = async (): Promise<void> => {
          for (let id = queue.shift(); id !== undefined; id = queue.shift()) await actions.generate(id, mode);
        };
        await Promise.all(Array.from({ length: Math.min(renderConcurrency, queue.length) }, worker));
      },

      cancelGeneration(shotId) {
        renderControllers.get(shotId)?.abort();
      },

      reset() {
        chatController?.abort();
        renderControllers.forEach((controller) => controller.abort());
        set({ ...INITIAL, info: get().info });
      },

      dismissError() {
        set({ error: null });
      },
    };

    return { ...INITIAL, ...actions };
  });
}
