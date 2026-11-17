// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { boardWithShots } from '../../domain/fixtures.js';
import type { AgentEvent } from '../../protocol/messages.js';
import { composeWeb } from '../composition-root.js';
import { FakeApi } from '../test-support/fake-api.js';

afterEach(cleanup);

function draftTurn(): AgentEvent[] {
  const board = boardWithShots(3);
  return [
    { type: 'text_delta', text: 'Here is a first pass.' },
    { type: 'tool_started', callId: 'c1', tool: 'create_storyboard' },
    { type: 'tool_finished', callId: 'c1', tool: 'create_storyboard', ok: true, summary: 'Created "Ceramic studio teaser": 3 shots' },
    { type: 'board', board },
    { type: 'finished', reason: 'end_turn' },
  ];
}

function mount(api: FakeApi) {
  const app = composeWeb({ api });
  render(app.root);
  return app;
}

async function sendBrief(text = 'A teaser for a ceramic studio') {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Here is a first pass.');
}

describe('App', () => {
  it('shows the demo banner and the empty states', async () => {
    mount(new FakeApi());
    expect(await screen.findByText('Demo mode')).toBeTruthy();
    expect(screen.getByText('Describe your video.')).toBeTruthy();
    expect(screen.getByText('Your storyboard appears here.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the banner when both Claude and Runway are live', async () => {
    mount(new FakeApi({ info: { planner: 'claude', providers: 'runway', model: 'claude-sonnet-5-5' } }));
    await waitFor(() => expect(screen.queryByText('Demo mode')).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('turns a brief into streamed chat, an inline action and storyboard cards', async () => {
    const api = new FakeApi({ chat: draftTurn });
    mount(api);
    await sendBrief();

    expect(screen.getByText('Created "Ceramic studio teaser": 3 shots')).toBeTruthy();
    const board = screen.getByRole('region', { name: 'Storyboard' });
    await waitFor(() => expect(within(board).getAllByRole('listitem')).toHaveLength(3));
    expect(within(board).getByText('3 shots · 12s · 16:9')).toBeTruthy();
    expect(api.chatRequests[0]?.messages).toEqual([{ role: 'user', content: 'A teaser for a ceramic studio' }]);
  });

  it('runs a shot render from its card and shows the result inline', async () => {
    const api = new FakeApi({
      chat: draftTurn,
      generate: (request) => [
        { type: 'generation_state', shotId: request.shotId, generation: { status: 'generating', mode: 'image', stage: 'keyframe', progress: 0.5 } },
        { type: 'keyframe_ready', shotId: request.shotId, url: '/api/mock/keyframe.svg?p=x&r=16:9' },
        { type: 'generation_state', shotId: request.shotId, generation: { status: 'done', mode: 'image' } },
      ],
    });
    mount(api);
    await sendBrief();

    const card = await screen.findByTestId('shot-shot_2');
    fireEvent.click(within(card).getByRole('button', { name: /Keyframe/ }));

    await waitFor(() => expect(within(card).getByText('Keyframe ready')).toBeTruthy());
    expect(within(card).getByRole('img').getAttribute('src')).toContain('/api/mock/keyframe.svg');
    expect(api.generateRequests[0]).toMatchObject({ shotId: 'shot_2', mode: 'image' });
  });

  it('surfaces a failed render on the card', async () => {
    const api = new FakeApi({
      chat: draftTurn,
      generate: (request) => [
        { type: 'generation_state', shotId: request.shotId, generation: { status: 'failed', mode: 'video', error: 'Content moderation' } },
      ],
    });
    mount(api);
    await sendBrief();
    const card = await screen.findByTestId('shot-shot_1');
    fireEvent.click(within(card).getByRole('button', { name: /Animate/ }));
    expect(await within(card).findByText('Content moderation')).toBeTruthy();
    expect(within(card).getByText('Failed')).toBeTruthy();
  });

  it('starts over from the toolbar', async () => {
    mount(new FakeApi({ chat: draftTurn }));
    await sendBrief();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(await screen.findByText('Your storyboard appears here.')).toBeTruthy();
  });
});
