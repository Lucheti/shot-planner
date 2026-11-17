/** One decoded server-sent event. */
export interface SseFrame {
  readonly event: string;
  readonly data: string;
}

/** Serialises a typed message as an SSE frame whose event name is the message `type`. */
export function encodeSse<T extends { readonly type: string }>(message: T): string {
  return `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`;
}

/** Incremental SSE decoder: feed it arbitrary text chunks, get complete frames back. */
export class SseParser {
  private buffer = '';

  /** Consumes a chunk and returns every frame it completed. */
  public push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const frames: SseFrame[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = parseFrame(this.buffer.slice(0, boundary));
      if (frame) frames.push(frame);
      this.buffer = this.buffer.slice(boundary + 2);
      boundary = this.buffer.indexOf('\n\n');
    }
    return frames;
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  return data.length === 0 ? null : { event, data: data.join('\n') };
}
