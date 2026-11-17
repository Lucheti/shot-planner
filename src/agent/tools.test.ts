import { describe, expect, it } from 'vitest';
import { boardWithShots, draft } from '../domain/fixtures.js';
import { estimateTokens, TokenBudgetTrimmer } from './token-budget.js';
import { ToolRegistry, ToolRunner } from './tool-runner.js';
import { createToolDefinitions } from './tools.js';

const registry = () => new ToolRegistry(createToolDefinitions());

describe('tool definitions', () => {
  it('expose the six tools with object JSON schemas and no $schema key', () => {
    const definitions = createToolDefinitions();
    expect(definitions.map((d) => d.name)).toEqual([
      'create_storyboard',
      'update_shot',
      'add_shot',
      'remove_shot',
      'reorder_shots',
      'generate_shot',
    ]);
    for (const definition of definitions) {
      const schema = definition.inputSchema();
      expect(schema.type).toBe('object');
      expect(schema).not.toHaveProperty('$schema');
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });

  it('carry the duration rule into the JSON schema', () => {
    const create = JSON.stringify(createToolDefinitions()[0]?.inputSchema());
    expect(create).toContain('"maximum":10');
    expect(create).toContain('"minimum":1');
  });

  it('parse valid input into domain tool calls', () => {
    const [, update, add] = createToolDefinitions();
    expect(update?.parse({ shotId: 'shot_1', patch: { framing: 'close-up' } })).toEqual({
      ok: true,
      value: { tool: 'update_shot', shotId: 'shot_1', patch: { framing: 'close-up' } },
    });
    const parsed = add?.parse({ shot: draft() });
    expect(parsed?.ok && parsed.value).toMatchObject({ tool: 'add_shot', afterShotId: null });
  });

  it('report readable validation errors', () => {
    const [, update] = createToolDefinitions();
    const parsed = update?.parse({ shotId: 'shot_1', patch: { framing: 'dutch-angle' } });
    expect(parsed?.ok).toBe(false);
    expect(!parsed?.ok && parsed?.error).toContain('framing');
  });
});

describe('ToolRunner', () => {
  const runner = new ToolRunner(registry());

  it('summarises successful edits for the chat', () => {
    const board = boardWithShots(3);
    const cases: [string, unknown, string][] = [
      ['update_shot', { shotId: 'shot_2', patch: { framing: 'close-up' } }, 'Updated shot 2: framing → close-up'],
      ['update_shot', { shotId: 'shot_1', patch: { durationSeconds: 2, description: 'new' } }, 'Updated shot 1: duration → 2s, description rewritten'],
      ['add_shot', { shot: draft({ framing: 'insert', durationSeconds: 3 }) }, 'Added shot 4 (insert, 3s)'],
      ['remove_shot', { shotId: 'shot_2' }, 'Removed shot 2'],
      ['reorder_shots', { order: ['shot_3', 'shot_1', 'shot_2'] }, 'Reordered shots: 3 → 1 → 2'],
      ['generate_shot', { shotId: 'shot_3', mode: 'image' }, 'Queued keyframe for shot 3'],
      ['generate_shot', { shotId: 'shot_3', mode: 'video' }, 'Queued video clip for shot 3'],
    ];
    for (const [name, input, summary] of cases) {
      const result = runner.run(name, input, board);
      expect(result.ok && result.summary).toBe(summary);
    }
  });

  it('returns the compact board to the model after a success', () => {
    const result = runner.run('remove_shot', { shotId: 'shot_1' }, boardWithShots(2));
    expect(result.ok && result.modelMessage).toContain('Removed shot 1.');
    expect(result.ok && result.modelMessage).toContain('id=shot_2');
  });

  it('only attaches a generation request to generate_shot', () => {
    const board = boardWithShots(1);
    const gen = runner.run('generate_shot', { shotId: 'shot_1', mode: 'video' }, board);
    const edit = runner.run('update_shot', { shotId: 'shot_1', patch: { framing: 'wide' } }, board);
    expect(gen.ok && gen.generation).toEqual({ shotId: 'shot_1', mode: 'video' });
    expect(edit.ok && edit.generation).toBeNull();
  });

  it('turns reducer errors into model-readable failures', () => {
    const result = runner.run('update_shot', { shotId: 'nope', patch: { framing: 'wide' } }, boardWithShots(1));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.modelMessage).toContain('Known shot ids: shot_1');
  });
});

describe('TokenBudgetTrimmer', () => {
  const msg = (role: 'user' | 'assistant', content: string) => ({ role, content }) as const;

  it('keeps everything when it fits', () => {
    const all = [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')];
    expect(new TokenBudgetTrimmer(1000).trim(all)).toEqual(all);
  });

  it('drops the oldest turns first and starts on a user turn', () => {
    const all = [msg('user', 'x'.repeat(400)), msg('assistant', 'reply'), msg('user', 'next')];
    expect(new TokenBudgetTrimmer(20).trim(all)).toEqual([msg('user', 'next')]);
  });

  it('always keeps the latest message even if it alone exceeds the budget', () => {
    expect(new TokenBudgetTrimmer(5).trim([msg('user', 'y'.repeat(1000))])).toHaveLength(1);
  });

  it('rejects a non-positive budget and estimates about four chars per token', () => {
    expect(() => new TokenBudgetTrimmer(0)).toThrow(RangeError);
    expect(estimateTokens('12345678')).toBe(2);
  });
});
