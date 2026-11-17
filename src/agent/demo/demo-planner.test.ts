import { describe, expect, it } from 'vitest';
import { emptyStoryboard, totalSeconds, type Storyboard } from '../../domain/storyboard.js';
import type { AgentEvent, ChatMessage } from '../../protocol/messages.js';
import { InstantSleeper } from '../../providers/test-doubles.js';
import { ToolRegistry, ToolRunner } from '../tool-runner.js';
import { createToolDefinitions } from '../tools.js';
import { DemoPlanner } from './demo-planner.js';
import { createDemoIntents } from './intents.js';
import { readBrief, splitDuration } from './shot-templates.js';

class Conversation {
  public board: Storyboard = emptyStoryboard();
  private readonly messages: ChatMessage[] = [];
  private readonly planner = new DemoPlanner(
    createDemoIntents(),
    new ToolRunner(new ToolRegistry(createToolDefinitions())),
    new InstantSleeper(),
  );

  public async say(text: string, signal = new AbortController().signal): Promise<AgentEvent[]> {
    this.messages.push({ role: 'user', content: text });
    const events: AgentEvent[] = [];
    for await (const event of this.planner.run({ messages: this.messages, board: this.board }, signal)) {
      events.push(event);
      if (event.type === 'board') this.board = event.board;
    }
    const reply = events.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');
    this.messages.push({ role: 'assistant', content: reply });
    return events;
  }
}

const textOf = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');

async function draftedConversation(): Promise<Conversation> {
  const chat = new Conversation();
  await chat.say('A 20-second teaser for a ceramic studio, warm morning light');
  await chat.say('16:9 please, and yes to the logo');
  return chat;
}

describe('DemoPlanner conversation', () => {
  it('asks a clarifying question first and touches no tools', async () => {
    const chat = new Conversation();
    const events = await chat.say('A 20-second teaser for a ceramic studio, warm morning light');
    expect(textOf(events)).toContain('16:9');
    expect(events.some((e) => e.type === 'tool_started')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'end_turn' });
  });

  it('then drafts a storyboard that matches the brief', async () => {
    const chat = await draftedConversation();
    expect(chat.board.shots).toHaveLength(6);
    expect(totalSeconds(chat.board)).toBe(20);
    expect(chat.board.aspectRatio).toBe('16:9');
    expect(chat.board.title).toBe('Ceramic studio: teaser');
    expect(chat.board.shots[0]?.prompt).toContain('a ceramic studio');
    expect(chat.board.shots[0]?.prompt).toContain('warm morning light');
  });

  it('honours a vertical request', async () => {
    const chat = new Conversation();
    await chat.say('A 15 second ad for a coffee cart');
    await chat.say('vertical, no logo');
    expect(chat.board.aspectRatio).toBe('9:16');
    expect(chat.board.shots).toHaveLength(5);
    expect(totalSeconds(chat.board)).toBe(15);
  });

  it('edits through the real tools and reports the inline actions', async () => {
    const chat = await draftedConversation();
    const events = await chat.say('make shot 3 a close-up');
    expect(chat.board.shots[2]?.framing).toBe('close-up');
    const finished = events.find((e) => e.type === 'tool_finished');
    expect(finished).toMatchObject({ ok: true, summary: 'Updated shot 3: framing → close-up, prompt rewritten' });
  });

  it('adds a final logo shot, shortens, removes and moves shots', async () => {
    const chat = await draftedConversation();
    await chat.say('add a final logo shot');
    expect(chat.board.shots).toHaveLength(7);

    const before = totalSeconds(chat.board);
    await chat.say('shorter');
    expect(totalSeconds(chat.board)).toBeLessThan(before);

    await chat.say('remove shot 1');
    expect(chat.board.shots).toHaveLength(6);

    const third = chat.board.shots[2]?.id;
    await chat.say('move shot 3 to the start');
    expect(chat.board.shots[0]?.id).toBe(third);
  });

  it('asks the client to generate every shot, or a single one as video', async () => {
    const chat = await draftedConversation();
    const all = await chat.say('generate all keyframes');
    expect(all.filter((e) => e.type === 'generation_requested')).toHaveLength(6);
    const one = await chat.say('animate shot 2 into a video');
    expect(one.filter((e) => e.type === 'generation_requested')).toEqual([
      { type: 'generation_requested', shotId: 'shot_2', mode: 'video' },
    ]);
  });

  it('says so when the shot does not exist, and falls back politely', async () => {
    const chat = await draftedConversation();
    expect(textOf(await chat.say('remove shot 42'))).toContain('cannot find');
    expect(textOf(await chat.say('hmm what about pizza'))).toContain('offline demo planner');
  });

  it('stops when cancelled', async () => {
    const chat = new Conversation();
    const controller = new AbortController();
    controller.abort();
    const events = await chat.say('A teaser for a bakery', controller.signal);
    expect(events).toEqual([{ type: 'finished', reason: 'cancelled' }]);
  });
});

describe('shot templates', () => {
  it.each([
    [20, [1, 1.1, 1.1, 0.9, 0.9]],
    [17, [1, 1.1, 1.1, 0.9, 0.9]],
    [5, [1, 1, 1, 1, 1]],
    [40, [1, 1, 1, 1, 1]],
  ])('splits %is across shots, whole seconds in range', (total, weights) => {
    const parts = splitDuration(total, weights);
    expect(parts.every((p) => Number.isInteger(p) && p >= 1 && p <= 10)).toBe(true);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(Math.min(total, weights.length * 10));
  });

  it('reads subject, look and length from the brief', () => {
    expect(readBrief('A 20-second teaser for a ceramic studio, warm morning light', '')).toMatchObject({
      subject: 'a ceramic studio',
      look: 'warm morning light',
      totalSeconds: 20,
    });
  });
});
