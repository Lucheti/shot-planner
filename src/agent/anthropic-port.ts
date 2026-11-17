import type Anthropic from '@anthropic-ai/sdk';

export type StreamParams = Anthropic.Messages.MessageStreamParams;
export type StreamEvent = Anthropic.Messages.MessageStreamEvent;
export type ModelMessage = Anthropic.Messages.Message;

/** The slice of a streaming response the agent relies on. */
export interface ModelStream extends AsyncIterable<StreamEvent> {
  finalMessage(): Promise<ModelMessage>;
}

/** The slice of the Anthropic client the agent relies on, so tests can replay scripted streams. */
export interface MessagesClient {
  readonly messages: {
    stream(params: StreamParams, options?: { signal?: AbortSignal }): ModelStream;
  };
}
