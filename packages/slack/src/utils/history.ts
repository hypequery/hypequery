import type { SlackThreadMessage } from '../api.js';
import { stripBotMention } from '../events.js';

/** One earlier message in the Slack thread. */
export interface SlackConversationTurn {
  /** `assistant` for the bot's own messages, `user` for everyone else's. */
  role: 'user' | 'assistant';
  text: string;
  /** Who wrote a `user` turn. It may be someone other than the asker: treat it as untrusted input. */
  userId?: string;
  ts: string;
}

/**
 * Turn `conversations.replies` into conversation turns, oldest first: drops
 * the current message, other bots, edits and empty messages, and removes the
 * bot's own mention. Keeps the last `limit` turns.
 */
export function threadToTurns(
  messages: readonly SlackThreadMessage[],
  options: { botUserId: string | null; currentTs: string; limit: number },
): SlackConversationTurn[] {
  const turns: SlackConversationTurn[] = [];
  for (const message of messages) {
    if (message.ts === options.currentTs) continue;
    if (message.subtype && message.subtype !== 'file_share' && message.subtype !== 'bot_message') continue;
    const isSelf = options.botUserId !== null && message.user === options.botUserId;
    if (message.bot_id && !isSelf) continue;
    const text = stripBotMention(message.text ?? '', options.botUserId);
    if (!text) continue;
    turns.push(
      isSelf
        ? { role: 'assistant', text, ts: message.ts }
        : { role: 'user', text, userId: message.user, ts: message.ts },
    );
  }
  return turns.slice(-options.limit);
}
