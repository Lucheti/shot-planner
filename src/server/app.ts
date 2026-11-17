import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import type { AspectRatio } from '../domain/shot.js';
import { findShot } from '../domain/storyboard.js';
import type { AgentRunner } from '../agent/loop.js';
import type { GenerationService } from '../generation/generation-service.js';
import {
  chatRequestSchema,
  generateRequestSchema,
  type AgentEvent,
  type AppInfo,
  type GenerateStreamMessage,
} from '../protocol/messages.js';
import { renderClipSvg, renderKeyframeSvg } from '../providers/mock-art.js';
import { MOCK_CLIP_PATH, MOCK_KEYFRAME_PATH, mockArtQuerySchema } from '../providers/mock-providers.js';
import { sseResponse } from './sse-response.js';

export interface AppDependencies {
  readonly agent: AgentRunner;
  readonly generation: GenerationService;
  readonly info: AppInfo;
  /** Directory of the built web app, served when present. */
  readonly staticRoot: string | null;
}

type MockArtRenderer = (prompt: string, aspectRatio: AspectRatio, seconds: number) => string;

const messageOf =(error: unknown): string => (error instanceof Error ? error.message : 'Unexpected server error.');

/** The HTTP surface: chat and generation streams, the mock art routes, and the built web app. */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/info', (c) => c.json(deps.info));

  app.post('/api/chat', async (c) => {
    const body = chatRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid chat request.', details: body.error.issues }, 400);
    const { messages, board } = body.data;
    return sseResponse<AgentEvent>(
      c,
      (signal) => deps.agent.run({ messages, board }, signal),
      (error) => ({ type: 'failed', message: messageOf(error) }),
    );
  });

  app.post('/api/generate', async (c) => {
    const body = generateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid generate request.', details: body.error.issues }, 400);
    const { board, shotId, mode } = body.data;
    const shot = findShot(board, shotId);
    if (!shot) return c.json({ error: `No shot with id "${shotId}".` }, 404);
    return sseResponse<GenerateStreamMessage>(
      c,
      (signal) => deps.generation.run({ shot, aspectRatio: board.aspectRatio, mode }, signal),
      (error) => ({ type: 'stream_error', message: messageOf(error) }),
    );
  });

  const mockArt = (render: MockArtRenderer) => (c: Context) => {
    const query = mockArtQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'Invalid mock art query.' }, 400);
    return c.body(render(query.data.p, query.data.r, query.data.s), 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  };
  app.get(MOCK_KEYFRAME_PATH, mockArt((p, r) => renderKeyframeSvg(p, r)));
  app.get(MOCK_CLIP_PATH, mockArt((p, r, s) => renderClipSvg(p, r, s)));

  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  if (deps.staticRoot !== null) {
    const root = deps.staticRoot;
    app.use('*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return app;
}
