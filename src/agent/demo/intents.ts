import { Duration } from '../../domain/duration.js';
import { isEmpty, type Storyboard } from '../../domain/storyboard.js';
import { buildShots, logoShot, readBrief, titleFor } from './shot-templates.js';

export type Beat =
  | { readonly kind: 'say'; readonly text: string }
  | { readonly kind: 'call'; readonly name: string; readonly input: unknown };

export interface DemoContext {
  readonly firstUser: string;
  readonly lastUser: string;
  readonly userTurns: number;
  readonly board: Storyboard;
}

/** One thing the demo planner knows how to do. The first intent that matches plans the turn. */
export interface DemoIntent {
  matches(context: DemoContext): boolean;
  plan(context: DemoContext): Beat[];
}

const say = (text: string): Beat => ({ kind: 'say', text });
const call = (name: string, input: unknown): Beat => ({ kind: 'call', name, input });

function shotNumberIn(text: string): number | null {
  const digits = /shot\s*#?\s*(\d+)/i.exec(text)?.[1];
  if (digits) return Number(digits);
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  const index = words.findIndex((word) => new RegExp(`\\b${word}\\s+shot\\b`, 'i').test(text));
  return index === -1 ? null : index + 1;
}

class AskClarifyingQuestion implements DemoIntent {
  public matches({ board, userTurns }: DemoContext): boolean {
    return isEmpty(board) && userTurns === 1;
  }

  public plan(): Beat[] {
    return [
      say(
        'Love the direction. Two quick questions before I draft the shot list: should this be widescreen 16:9 or vertical 9:16 for social, and would you like it to end on a logo card?',
      ),
    ];
  }
}

class DraftStoryboard implements DemoIntent {
  public matches({ board }: DemoContext): boolean {
    return isEmpty(board);
  }

  public plan({ firstUser, lastUser }: DemoContext): Beat[] {
    const brief = readBrief(firstUser, lastUser);
    return [
      say('Got it. Here is a first pass.'),
      call('create_storyboard', { title: titleFor(brief), aspectRatio: brief.aspectRatio, shots: buildShots(brief) }),
      say(
        `That is ${brief.totalSeconds} seconds in ${brief.aspectRatio}. Tell me what to change, for example "make shot 2 a close-up", or press Generate on any card.`,
      ),
    ];
  }
}

class GenerateShots implements DemoIntent {
  public matches({ lastUser }: DemoContext): boolean {
    return /generat|render|animate|keyframe|\bvideo\b|\bclip\b/i.test(lastUser);
  }

  public plan({ lastUser, board }: DemoContext): Beat[] {
    const mode = /video|animate|clip/i.test(lastUser) ? 'video' : 'image';
    const number = shotNumberIn(lastUser);
    const targets = number === null ? board.shots : board.shots.slice(number - 1, number);
    if (targets.length === 0) return [say(`I cannot find shot ${number}. The board has ${board.shots.length} shots.`)];
    return [
      say(`Starting ${mode === 'video' ? 'video clips' : 'keyframes'} for ${number === null ? 'every shot' : `shot ${number}`}.`),
      ...targets.map((shot) => call('generate_shot', { shotId: shot.id, mode })),
      say('You can watch progress on each card.'),
    ];
  }
}

class RemoveShot implements DemoIntent {
  public matches({ lastUser }: DemoContext): boolean {
    return /\b(remove|delete|drop|cut)\b/i.test(lastUser) && shotNumberIn(lastUser) !== null;
  }

  public plan({ lastUser, board }: DemoContext): Beat[] {
    const shot = board.shots[(shotNumberIn(lastUser) ?? 0) - 1];
    if (!shot) return [say('I cannot find that shot on the board.')];
    return [call('remove_shot', { shotId: shot.id }), say('Removed. The remaining shots keep their order.')];
  }
}

class MoveShotFirst implements DemoIntent {
  public matches({ lastUser }: DemoContext): boolean {
    return /\b(move|swap|put)\b.*\b(first|start|beginning|opening)\b/i.test(lastUser) && shotNumberIn(lastUser) !== null;
  }

  public plan({ lastUser, board }: DemoContext): Beat[] {
    const shot = board.shots[(shotNumberIn(lastUser) ?? 0) - 1];
    if (!shot) return [say('I cannot find that shot on the board.')];
    const order = [shot.id, ...board.shots.filter((s) => s.id !== shot.id).map((s) => s.id)];
    return [call('reorder_shots', { order }), say('Done, it now opens the film.')];
  }
}

class AddLogoShot implements DemoIntent {
  public matches({ lastUser }: DemoContext): boolean {
    return /\b(add|end|finish|close)\b.*\b(logo|final|last)\b|\blogo\b/i.test(lastUser);
  }

  public plan({ firstUser, lastUser, board }: DemoContext): Beat[] {
    const brief = readBrief(firstUser, lastUser);
    return [
      call('add_shot', { shot: logoShot(brief, 3) }),
      say(`I added a three second logo end card as shot ${board.shots.length + 1}.`),
    ];
  }
}

class ChangePacing implements DemoIntent {
  public matches({ lastUser }: DemoContext): boolean {
    return /\b(shorter|faster|tighter|quicker|longer|slower)\b/i.test(lastUser);
  }

  public plan({ lastUser, board }: DemoContext): Beat[] {
    const factor = /longer|slower/i.test(lastUser) ? 1.3 : 0.7;
    const calls = board.shots.map((shot) => {
      const current = Duration.of(shot.durationSeconds);
      const next = current.ok ? current.value.scaledBy(factor).seconds : shot.durationSeconds;
      return call('update_shot', { shotId: shot.id, patch: { durationSeconds: next } });
    });
    return [say(factor < 1 ? 'Tightening every shot.' : 'Giving every shot more room.'), ...calls];
  }
}

class ChangeFraming implements DemoIntent {
  public matches({ lastUser }: DemoContext): boolean {
    return /close[- ]?up|\bwide\b|\bmedium\b/i.test(lastUser) && shotNumberIn(lastUser) !== null;
  }

  public plan({ lastUser, board }: DemoContext): Beat[] {
    const shot = board.shots[(shotNumberIn(lastUser) ?? 0) - 1];
    if (!shot) return [say('I cannot find that shot on the board.')];
    const framing = /extreme[- ]close/i.test(lastUser)
      ? 'extreme-close-up'
      : /close[- ]?up/i.test(lastUser)
        ? 'close-up'
        : /wide/i.test(lastUser)
          ? 'wide'
          : 'medium';
    return [
      call('update_shot', {
        shotId: shot.id,
        patch: {
          framing,
          prompt: `${framing.replace(/-/g, ' ')} framing. ${shot.prompt}`.slice(0, 900),
        },
      }),
      say('Changed the framing and rewrote the prompt to match.'),
    ];
  }
}

class Fallback implements DemoIntent {
  public matches(): boolean {
    return true;
  }

  public plan(): Beat[] {
    return [
      say(
        'This is the offline demo planner, so I only know a few moves. Try "make shot 2 a close-up", "add a final logo shot", "shorter", "remove shot 3", "move shot 4 to the start", or "generate all". Add an ANTHROPIC_API_KEY to talk to the real agent.',
      ),
    ];
  }
}

/** The demo planner's repertoire, most specific first. */
export function createDemoIntents(): readonly DemoIntent[] {
  return [
    new AskClarifyingQuestion(),
    new DraftStoryboard(),
    new GenerateShots(),
    new RemoveShot(),
    new MoveShotFirst(),
    new AddLogoShot(),
    new ChangePacing(),
    new ChangeFraming(),
    new Fallback(),
  ];
}
