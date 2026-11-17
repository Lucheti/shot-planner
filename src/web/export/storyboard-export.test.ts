import { describe, expect, it } from 'vitest';
import { applyGenerationEvent } from '../../domain/generation.js';
import { boardWithShots } from '../../domain/fixtures.js';
import { emptyStoryboard } from '../../domain/storyboard.js';
import { describeGeneration, formatSeconds } from '../format.js';
import { EXPORT_FORMAT, exportFilename, storyboardToJson } from './storyboard-export.js';

describe('storyboardToJson', () => {
  it('exports numbered shots with their plan and media', () => {
    let board = boardWithShots(2);
    board = applyGenerationEvent(board, { type: 'keyframe_ready', shotId: 'shot_1', url: '/k.svg' });
    board = applyGenerationEvent(board, { type: 'clip_ready', shotId: 'shot_1', clip: { url: '/c.mp4', mimeType: 'video/mp4' } });
    const exported = JSON.parse(storyboardToJson(board)) as Record<string, unknown> & { shots: Record<string, unknown>[] };
    expect(exported).toMatchObject({ format: EXPORT_FORMAT, title: 'Ceramic studio teaser', totalSeconds: 8, aspectRatio: '16:9' });
    expect(exported.shots[0]).toMatchObject({ number: 1, id: 'shot_1', keyframeUrl: '/k.svg', clipUrl: '/c.mp4' });
    expect(exported.shots[1]).toMatchObject({ number: 2, keyframeUrl: null, clipUrl: null });
    expect(exported.shots[0]).not.toHaveProperty('generation');
  });
});

describe('exportFilename', () => {
  it('slugs the title and falls back for an untitled board', () => {
    expect(exportFilename(boardWithShots(1), 'json')).toBe('ceramic-studio-teaser.json');
    expect(exportFilename(emptyStoryboard(), 'json')).toBe('storyboard.json');
  });
});

describe('format helpers', () => {
  it('describes every generation state', () => {
    expect(describeGeneration({ status: 'idle' })).toMatchObject({ tone: 'neutral', progress: null });
    expect(describeGeneration({ status: 'queued', mode: 'image' })).toMatchObject({ label: 'Queued', progress: 0 });
    expect(describeGeneration({ status: 'generating', mode: 'video', stage: 'clip', progress: 0.42 })).toEqual({
      label: 'Clip 42%',
      tone: 'active',
      progress: 0.42,
    });
    expect(describeGeneration({ status: 'done', mode: 'video' }).label).toBe('Clip ready');
    expect(describeGeneration({ status: 'done', mode: 'image' }).label).toBe('Keyframe ready');
    expect(describeGeneration({ status: 'failed', mode: 'image', error: 'x' }).tone).toBe('danger');
  });

  it('formats durations', () => {
    expect(formatSeconds(8)).toBe('8s');
    expect(formatSeconds(75)).toBe('1:15');
  });
});
