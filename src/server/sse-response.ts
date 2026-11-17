import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { encodeSse } from '../protocol/sse.js';

/**
 * Streams typed messages as server-sent events. The source receives an `AbortSignal` that fires
 * when the client disconnects (the stop button, a closed tab), so upstream work can stop.
 */
export function sseResponse<T extends { readonly type: string }>(
  c: Context,
  source: (signal: AbortSignal) => AsyncIterable<T>,
  toErrorMessage: (error: unknown) => T,
): Response {
  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    try {
      for await (const message of source(controller.signal)) {
        if (controller.signal.aborted) break;
        await stream.write(encodeSse(message));
      }
    } catch (error) {
      if (!controller.signal.aborted) await stream.write(encodeSse(toErrorMessage(error)));
    }
  });
}
