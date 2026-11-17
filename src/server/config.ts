import { z } from 'zod';
import { RUNWAY_VIDEO_MODELS, type RunwayVideoModel } from '../providers/runway.js';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export interface AppConfig {
  readonly port: number;
  readonly webDistDir: string;
  readonly anthropic: {
    readonly apiKey: string | null;
    readonly model: string;
    readonly maxSteps: number;
    readonly maxOutputTokens: number;
    readonly contextBudgetTokens: number;
  };
  readonly runway: {
    readonly apiKey: string | null;
    readonly videoModel: RunwayVideoModel;
    readonly pollIntervalMs: number;
    readonly timeoutMs: number;
  };
}

const blankAsUndefined = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optionalString = z.preprocess(blankAsUndefined, z.string().trim().optional());
const positiveInt = (fallback: number) => z.preprocess(blankAsUndefined, z.coerce.number().int().positive().default(fallback));

const envSchema = z.object({
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.preprocess(blankAsUndefined, z.string().default(DEFAULT_MODEL)),
  RUNWAYML_API_SECRET: optionalString,
  RUNWAY_VIDEO_MODEL: z.preprocess(blankAsUndefined, z.enum(RUNWAY_VIDEO_MODELS).default('gen4.5')),
  AGENT_MAX_STEPS: positiveInt(8),
  AGENT_MAX_OUTPUT_TOKENS: positiveInt(8192),
  AGENT_CONTEXT_BUDGET_TOKENS: positiveInt(24_000),
  PORT: positiveInt(8787),
  WEB_DIST_DIR: z.preprocess(blankAsUndefined, z.string().default('dist/web')),
});

/** Reads and validates the environment. Missing keys are fine: they select demo mode. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    webDistDir: parsed.WEB_DIST_DIR,
    anthropic: {
      apiKey: parsed.ANTHROPIC_API_KEY ?? null,
      model: parsed.ANTHROPIC_MODEL,
      maxSteps: parsed.AGENT_MAX_STEPS,
      maxOutputTokens: parsed.AGENT_MAX_OUTPUT_TOKENS,
      contextBudgetTokens: parsed.AGENT_CONTEXT_BUDGET_TOKENS,
    },
    runway: {
      apiKey: parsed.RUNWAYML_API_SECRET ?? null,
      videoModel: parsed.RUNWAY_VIDEO_MODEL,
      pollIntervalMs: 3000,
      timeoutMs: 8 * 60_000,
    },
  };
}
