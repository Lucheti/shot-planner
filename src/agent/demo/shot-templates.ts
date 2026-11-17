import type { AspectRatio, ShotDraft } from '../../domain/shot.js';

/** What the demo planner understood about the brief. */
export interface DemoBrief {
  readonly subject: string;
  readonly look: string;
  readonly totalSeconds: number;
  readonly aspectRatio: AspectRatio;
  readonly withLogo: boolean;
}

const DEFAULT_SECONDS = 20;
const WEIGHTS = [1, 1.1, 1.1, 0.9, 0.9];

/** Reads a free-text brief the way a human producer would skim it. */
export function readBrief(brief: string, followUp: string): DemoBrief {
  const subject = /\b(?:for|about|of)\s+((?:a|an|the|my|our)\s+[^,.:;]+)/i.exec(brief)?.[1]?.trim() ?? 'the subject';
  const look = /,\s*([^,.]{3,60})/.exec(brief)?.[1]?.trim() ?? 'soft natural light';
  const seconds = /(\d{1,3})\s*-?\s*(?:s|sec|secs|second|seconds)\b/i.exec(brief)?.[1];
  const both = `${brief} ${followUp}`;
  return {
    subject,
    look,
    totalSeconds: Math.min(40, Math.max(5, seconds ? Number(seconds) : DEFAULT_SECONDS)),
    aspectRatio: /vertical|9:16|social|tiktok|reel|story/i.test(both) ? '9:16' : '16:9',
    withLogo: /logo|yes|sure|end card/i.test(followUp) && !/\b(no|without|skip)\b.{0,12}logo/i.test(followUp),
  };
}

/** Splits `total` seconds across the shots by weight, each whole and within 1-10, summing as close as possible. */
export function splitDuration(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.min(10, Math.max(1, Math.round((total * w) / sum))));
  let drift = total - parts.reduce((a, b) => a + b, 0);
  for (let i = parts.length - 1; i >= 0 && drift !== 0; i -= 1) {
    const next = Math.min(10, Math.max(1, (parts[i] ?? 1) + drift));
    drift -= next - (parts[i] ?? 1);
    parts[i] = next;
  }
  return parts;
}

export function titleFor(brief: DemoBrief): string {
  const bare = brief.subject.replace(/^(a|an|the|my|our)\s+/i, '');
  return `${bare.charAt(0).toUpperCase()}${bare.slice(1)}: teaser`;
}

export function logoShot(brief: DemoBrief, durationSeconds = 3): ShotDraft {
  return {
    durationSeconds,
    framing: 'medium',
    cameraMove: 'static',
    description: `End card: the logo of ${brief.subject} rests on a clean, softly lit background.`,
    prompt: `Minimal end card for ${brief.subject}, a simple logo mark centred on a plain surface, ${brief.look}, generous negative space, calm and confident, soft shadow`,
  };
}

/** A five-beat teaser: establish, detail, process, texture, payoff. */
export function buildShots(brief: DemoBrief): ShotDraft[] {
  const { subject, look } = brief;
  const durations = splitDuration(brief.totalSeconds - (brief.withLogo ? 3 : 0), WEIGHTS);
  const beats: Omit<ShotDraft, 'durationSeconds'>[] = [
    {
      framing: 'wide',
      cameraMove: 'dolly-in',
      description: `We open on ${subject} as the day begins, quiet and unhurried.`,
      prompt: `Wide establishing shot of ${subject}, ${look}, long soft shadows, warm terracotta and cream palette, 35mm film look, gentle haze`,
    },
    {
      framing: 'close-up',
      cameraMove: 'static',
      description: 'Hands at work: the first tactile detail that tells us this is made with care.',
      prompt: `Close-up of hands working at ${subject}, ${look}, shallow depth of field, fine dust in the air, warm terracotta and cream palette, 50mm lens`,
    },
    {
      framing: 'medium',
      cameraMove: 'tracking',
      description: 'The process in motion; we follow the maker from one station to the next.',
      prompt: `Medium shot following a maker through ${subject}, ${look}, natural movement, warm terracotta and cream palette, handheld feel, 35mm film look`,
    },
    {
      framing: 'insert',
      cameraMove: 'pan-right',
      description: 'A slow reveal of finished pieces lined up in the light.',
      prompt: `Insert shot of finished pieces on a wooden shelf at ${subject}, ${look}, rich texture, warm terracotta and cream palette, macro detail`,
    },
    {
      framing: 'wide',
      cameraMove: 'dolly-out',
      description: 'We pull back to the full space, now alive with light: the payoff.',
      prompt: `Wide payoff shot of ${subject} bathed in light, ${look}, inviting and calm, warm terracotta and cream palette, 35mm film look`,
    },
  ];
  const shots = beats.map((beat, i) => ({ ...beat, durationSeconds: durations[i] ?? 4 }));
  return brief.withLogo ? [...shots, logoShot(brief)] : shots;
}
