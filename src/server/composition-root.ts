import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import RunwayML from '@runwayml/sdk';
import { DemoPlanner } from '../agent/demo/demo-planner.js';
import { createDemoIntents } from '../agent/demo/intents.js';
import { ClaudeAgentRunner, type AgentRunner } from '../agent/loop.js';
import { TokenBudgetTrimmer } from '../agent/token-budget.js';
import { ToolRegistry, ToolRunner } from '../agent/tool-runner.js';
import { createToolDefinitions } from '../agent/tools.js';
import { GenerationService } from '../generation/generation-service.js';
import type { AppInfo } from '../protocol/messages.js';
import { MockImageProvider, MockVideoProvider } from '../providers/mock-providers.js';
import { RunwayImageProvider, RunwaySdkApi, RunwayVideoProvider } from '../providers/runway.js';
import { SystemClock, SystemSleeper } from '../providers/time.js';
import type { ImageProvider, VideoProvider } from '../providers/types.js';
import { createApp } from './app.js';
import type { AppConfig } from './config.js';

interface Providers {
  readonly image: ImageProvider;
  readonly video: VideoProvider;
}

/**
 * The server's single composition root: the only place that chooses concrete classes.
 * Keys decide the mode: a Claude key selects the real agent, a Runway key selects the real
 * providers, and anything missing falls back to the scripted planner or the mock providers.
 */
export function composeServer(config: AppConfig) {
  const sleeper = new SystemSleeper();
  const registry = new ToolRegistry(createToolDefinitions());
  const runner = new ToolRunner(registry);

  const agent: AgentRunner = config.anthropic.apiKey
    ? new ClaudeAgentRunner(
        {
          model: config.anthropic.model,
          maxSteps: config.anthropic.maxSteps,
          maxOutputTokens: config.anthropic.maxOutputTokens,
        },
        {
          client: new Anthropic({ apiKey: config.anthropic.apiKey }),
          registry,
          runner,
          trimmer: new TokenBudgetTrimmer(config.anthropic.contextBudgetTokens),
        },
      )
    : new DemoPlanner(createDemoIntents(), runner, sleeper);

  const providers: Providers = config.runway.apiKey
    ? composeRunway(config, config.runway.apiKey)
    : { image: new MockImageProvider(sleeper), video: new MockVideoProvider(new SystemClock()) };

  const generation = new GenerationService(providers.image, providers.video, sleeper, {
    intervalMs: config.runway.apiKey ? config.runway.pollIntervalMs : 500,
    timeoutMs: config.runway.timeoutMs,
  });

  const info: AppInfo = {
    planner: config.anthropic.apiKey ? 'claude' : 'mock',
    providers: config.runway.apiKey ? 'runway' : 'mock',
    model: config.anthropic.apiKey ? config.anthropic.model : null,
  };

  return createApp({ agent, generation, info, staticRoot: resolveStaticRoot(config.webDistDir) });
}

function composeRunway(config: AppConfig, apiKey: string): Providers {
  const api = new RunwaySdkApi(new RunwayML({ apiKey }));
  return {
    image: new RunwayImageProvider(api, new SystemSleeper(), {
      intervalMs: config.runway.pollIntervalMs,
      timeoutMs: config.runway.timeoutMs,
    }),
    video: new RunwayVideoProvider(api, config.runway.videoModel),
  };
}

function resolveStaticRoot(webDistDir: string): string | null {
  const absolute = resolve(webDistDir);
  return existsSync(resolve(absolute, 'index.html')) ? relative(process.cwd(), absolute) || '.' : null;
}
