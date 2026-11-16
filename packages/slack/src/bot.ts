/**
 * `createSlackBot()`: the question → answer flow for an analytics bot, on top
 * of the transport. You supply who may ask what (`resolveAccess`) and how to
 * answer (`answer`, usually an agent loop over hypequery's tools); the bot
 * handles status, thread history, private replies, errors and rendering.
 *
 * Access follows the channel-ceiling model: a channel reply is visible to
 * everyone in the channel, so `resolveAccess` decides whether an answer may be
 * posted in the thread or must go to the asker privately.
 */

import type { SlackClient, SlackSuggestedPrompt } from './api.js';
import { renderSlackAnswer, renderSlackError, type RenderOptions, type SlackAnswer, type SlackMessage } from './blocks.js';
import type { SlackHandlers } from './dispatch.js';
import type { SlackInboundEvent } from './events.js';
import { threadToTurns, type SlackConversationTurn } from './utils/history.js';

type QuestionEvent = Extract<SlackInboundEvent, { kind: 'question' }>;
type ThreadStartedEvent = Extract<SlackInboundEvent, { kind: 'assistant_thread_started' }>;

/** Where the asker is, for `resolveAccess`. */
export interface SlackAskContext {
  teamId: string | null;
  enterpriseId: string | null;
  channelId: string;
  userId: string;
  source: 'mention' | 'dm';
  isExtSharedChannel: boolean;
}

/**
 * - `allow` with `reply: 'thread'`: answer in the thread, visible to the channel.
 * - `allow` with `reply: 'private'`: the asker's access is above what this
 *   channel may see; answer only to them.
 * - `deny`: say why, privately (not linked, channel not connected, no access).
 */
export type SlackAccessDecision<TAccess> =
  | { allow: true; access: TAccess; reply: 'thread' | 'private' }
  | { allow: false; message: string; hint?: string };

export interface SlackQuestion<TAccess> {
  text: string;
  /** Earlier messages in the thread, oldest first. Other people's turns are untrusted input. */
  history: SlackConversationTurn[];
  access: TAccess;
  context: SlackAskContext;
  /** Aborted when `timeoutMs` passes. */
  signal: AbortSignal;
}

export interface SlackBotOptions<TAccess> {
  /** One client, or one per workspace for multi-workspace installs. */
  slack: SlackClient | ((origin: { teamId: string | null; enterpriseId: string | null }) => SlackClient | Promise<SlackClient>);
  resolveAccess: (context: SlackAskContext) => SlackAccessDecision<TAccess> | Promise<SlackAccessDecision<TAccess>>;
  /** Return Markdown text, or a `SlackAnswer` with a table and source (see `answerFromToolResults`). */
  answer: (question: SlackQuestion<TAccess>) => string | SlackAnswer | Promise<string | SlackAnswer>;
  /** Shown when a user opens a new assistant thread, and for an empty question. */
  suggestedPrompts?: SlackSuggestedPrompt[];
  /** The assistant pane's status line while answering. @default 'is looking at the data…' */
  status?: string;
  /** Private answers in a channel: an ephemeral message in the thread, or a DM. @default 'ephemeral' */
  privateReply?: 'ephemeral' | 'dm';
  /** Earlier thread messages passed as `history`. @default 20 */
  historyLimit?: number;
  /** Answer in Slack Connect channels shared with other organizations. @default false */
  allowSharedChannels?: boolean;
  /** @default 120000 */
  timeoutMs?: number;
  render?: RenderOptions;
  /** Map a failure to what the user sees. @default a generic message; never the raw error */
  describeError?: (error: unknown) => { message: string; hint?: string; requestId?: string };
  onError?: (error: unknown, context: { eventId: string }) => void;
}

export interface SlackBot {
  /** Pass to `createSlackRequestHandler` or `createSocketModeClient`. */
  onEvent: NonNullable<SlackHandlers['onEvent']>;
}

const PRIVATE_NOTE = 'Only you can see this answer: it uses data beyond what this channel can see.';
/** The most thread messages read for history; the newest `historyLimit` turns are kept. */
const MAX_THREAD_MESSAGES = 1_000;
const SHARED_CHANNEL_MESSAGE = "I don't answer in channels shared with other organizations. Ask me in a DM instead.";

export function createSlackBot<TAccess>(options: SlackBotOptions<TAccess>): SlackBot {
  const status = options.status ?? 'is looking at the data…';
  const historyLimit = options.historyLimit ?? 20;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const describeError =
    options.describeError ??
    (() => ({ message: "Sorry, I couldn't answer that. Try again, or rephrase the question." }));
  const onError = options.onError ?? ((error: unknown) => console.error('[hypequery/slack]', error));

  const clientFor = async (origin: { teamId: string | null; enterpriseId: string | null }) =>
    typeof options.slack === 'function' ? options.slack(origin) : options.slack;

  async function onThreadStarted(event: ThreadStartedEvent): Promise<void> {
    if (!options.suggestedPrompts?.length) return;
    const slack = await clientFor(event);
    await slack.setSuggestedPrompts({
      channel_id: event.channelId,
      thread_ts: event.threadTs,
      prompts: options.suggestedPrompts.slice(0, 4),
    });
  }

  async function onQuestion(event: QuestionEvent): Promise<void> {
    const slack = await clientFor(event);
    const inDm = event.source === 'dm';

    const replyTo = async (message: SlackMessage, mode: 'thread' | 'private') => {
      if (mode === 'thread' || inDm) {
        // A top-level DM gets a top-level reply; everything else stays in its thread.
        const threadTs = inDm && !event.inThread ? undefined : event.threadTs;
        await slack.postMessage({ channel: event.channelId, thread_ts: threadTs, ...message, unfurl_links: false });
      } else if (options.privateReply === 'dm') {
        const { channel } = await slack.call<{ channel: { id: string } }>('conversations.open', { users: event.userId });
        await slack.postMessage({ channel: channel.id, ...message, unfurl_links: false });
      } else {
        await slack.postEphemeral({ channel: event.channelId, user: event.userId, thread_ts: event.threadTs, ...message });
      }
    };

    if (event.isExtSharedChannel && !options.allowSharedChannels) {
      await replyTo(renderSlackError({ message: SHARED_CHANNEL_MESSAGE }), 'private');
      return;
    }

    if (!event.text) {
      const examples = options.suggestedPrompts?.map(prompt => `• ${prompt.message}`).join('\n');
      await replyTo(
        renderSlackAnswer({ text: examples ? `Ask me about your data, for example:\n${examples}` : 'Ask me a question about your data.' }),
        'private',
      );
      return;
    }

    const context: SlackAskContext = {
      teamId: event.teamId,
      enterpriseId: event.enterpriseId,
      channelId: event.channelId,
      userId: event.userId,
      source: event.source,
      isExtSharedChannel: event.isExtSharedChannel,
    };
    const decision = await options.resolveAccess(context);
    if (!decision.allow) {
      await replyTo(renderSlackError({ message: decision.message, hint: decision.hint }), 'private');
      return;
    }
    const mode = inDm ? 'thread' : decision.reply;

    // Never wait on the status before answering: a rate-limited status call
    // must not delay the answer. It is cleared once the first call settles.
    const setStatus = (value: string) =>
      slack.setAssistantStatus({ channel_id: event.channelId, thread_ts: event.threadTs, status: value }).catch(() => undefined);
    const statusSet = setStatus(status);

    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const result = await untilAborted(signal, async () => {
        const history = event.inThread ? await loadHistory(slack, event) : [];
        return options.answer({ text: event.text, history, access: decision.access, context, signal });
      });
      const answer: SlackAnswer = typeof result === 'string' ? { text: result } : result;
      const privateInChannel = mode === 'private' && !inDm;
      const message = renderSlackAnswer(answer, privateInChannel ? { ...options.render, reserveBlocks: 1 } : options.render);
      if (privateInChannel) message.blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: PRIVATE_NOTE }] });
      await replyTo(message, mode);
    } catch (error) {
      onError(error, { eventId: event.eventId });
      // Errors go to the asker only: they can mention datasets the channel can't see.
      await replyTo(renderSlackError(describeError(error)), 'private');
    } finally {
      await statusSet;
      await setStatus('');
    }
  }

  async function loadHistory(slack: SlackClient, event: QuestionEvent): Promise<SlackConversationTurn[]> {
    // Channel threads need channels:history / groups:history, which an app may
    // not request. Without them, answer without context rather than fail.
    // Replies come oldest first, so read up to the current message and keep
    // the newest turns; stopping at the first page would keep the oldest.
    const messages = await slack
      .threadReplies({ channel: event.channelId, ts: event.threadTs, latest: event.ts, limit: MAX_THREAD_MESSAGES })
      .catch(() => []);
    return threadToTurns(messages, { botUserId: event.botUserId, currentTs: event.ts, limit: historyLimit });
  }

  return {
    async onEvent(event) {
      try {
        if (event.kind === 'question') await onQuestion(event);
        else if (event.kind === 'assistant_thread_started') await onThreadStarted(event);
      } catch (error) {
        onError(error, { eventId: event.eventId });
      }
    },
  };
}

/** `work()`, rejected with the signal's reason if it aborts first (for `timeoutMs`). */
function untilAborted<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work().then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * The channel-ceiling rule as a helper. `fits(ceiling, access)` says whether
 * `access` is within what the channel may see. In DMs, or when it fits, the
 * answer goes in the thread; otherwise privately. A channel with no ceiling
 * (not connected) is denied.
 */
export function channelCeiling<TAccess, TCeiling>(input: {
  access: TAccess;
  ceiling: TCeiling | null;
  source: 'mention' | 'dm';
  fits: (ceiling: TCeiling, access: TAccess) => boolean;
  notConnectedMessage?: string;
}): SlackAccessDecision<TAccess> {
  if (input.source === 'dm') return { allow: true, access: input.access, reply: 'thread' };
  if (input.ceiling === null) {
    return {
      allow: false,
      message: input.notConnectedMessage ?? "This channel isn't connected to hypequery yet. Ask me in a DM, or ask an admin to connect it.",
    };
  }
  return { allow: true, access: input.access, reply: input.fits(input.ceiling, input.access) ? 'thread' : 'private' };
}
