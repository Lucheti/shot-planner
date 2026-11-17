import type { ChatMessage } from '../protocol/messages.js';

/** Decides which part of a conversation is sent to the model. */
export interface ConversationTrimmer {
  trim(messages: readonly ChatMessage[]): ChatMessage[];
}

/** Rough token count: about four characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Keeps the newest messages that fit a token budget. The board travels in the system prompt,
 * so dropping old turns loses chatter, not state. The last message is always kept, and the
 * result always starts with a user turn.
 */
export class TokenBudgetTrimmer implements ConversationTrimmer {
  constructor(private readonly budgetTokens: number) {
    if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) throw new RangeError('budgetTokens must be positive');
  }

  public trim(messages: readonly ChatMessage[]): ChatMessage[] {
    const kept: ChatMessage[] = [];
    let used = 0;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message) continue;
      const cost = estimateTokens(message.content) + 4;
      if (kept.length > 0 && used + cost > this.budgetTokens) break;
      kept.unshift(message);
      used += cost;
    }
    while (kept.length > 1 && kept[0]?.role !== 'user') kept.shift();
    return kept;
  }
}
