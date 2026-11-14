/**
 * Parse Slack request bodies and normalize the events a hypequery bot handles
 * into one small union. Everything Slack sends that the bot does not act on
 * becomes `{ kind: 'ignored' }`, so callers can ack it and move on.
 */

/** The Events API envelope (`type: 'event_callback'`), trimmed to what is read here. */
export interface SlackEventEnvelope {
  type: 'event_callback';
  team_id?: string;
  enterprise_id?: string | null;
  api_app_id?: string;
  event_id: string;
  event_time?: number;
  is_ext_shared_channel?: boolean;
  authorizations?: Array<{
    enterprise_id?: string | null;
    team_id?: string | null;
    user_id?: string;
    is_bot?: boolean;
    is_enterprise_install?: boolean;
  }>;
  event: SlackRawEvent;
}

export interface SlackRawEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  event_ts?: string;
  team?: string;
  assistant_thread?: {
    user_id?: string;
    channel_id?: string;
    thread_ts?: string;
    context?: { channel_id?: string; team_id?: string; enterprise_id?: string | null };
  };
  tokens?: { oauth?: string[]; bot?: string[] };
  [key: string]: unknown;
}

/** A slash command, sent form-encoded. */
export interface SlackSlashCommand {
  command: string;
  text: string;
  team_id: string;
  enterprise_id?: string;
  channel_id: string;
  user_id: string;
  response_url: string;
  trigger_id: string;
  [key: string]: string | undefined;
}

export type SlackRequestBody =
  | { type: 'url_verification'; challenge: string }
  | { type: 'event'; envelope: SlackEventEnvelope }
  | { type: 'interaction'; payload: Record<string, unknown> }
  | { type: 'command'; command: SlackSlashCommand }
  | { type: 'unknown' };

/**
 * Parse a verified request body. Events API requests are JSON; interactions
 * (`payload=`) and slash commands are `application/x-www-form-urlencoded`.
 * Never throws: anything unrecognised is `{ type: 'unknown' }`.
 */
export function parseSlackBody(rawBody: string, contentType?: string | null): SlackRequestBody {
  const isForm = contentType?.includes('application/x-www-form-urlencoded') ?? !rawBody.trimStart().startsWith('{');
  if (isForm) {
    const params = new URLSearchParams(rawBody);
    const payload = params.get('payload');
    if (payload !== null) {
      const parsed = safeJson(payload);
      return isRecord(parsed) ? { type: 'interaction', payload: parsed } : { type: 'unknown' };
    }
    if (params.has('command')) {
      return { type: 'command', command: Object.fromEntries(params) as SlackSlashCommand };
    }
    return { type: 'unknown' };
  }

  const parsed = safeJson(rawBody);
  if (!isRecord(parsed)) return { type: 'unknown' };
  if (parsed.type === 'url_verification' && typeof parsed.challenge === 'string') {
    return { type: 'url_verification', challenge: parsed.challenge };
  }
  if (parsed.type === 'event_callback' && typeof parsed.event_id === 'string' && isRecord(parsed.event)) {
    return { type: 'event', envelope: parsed as unknown as SlackEventEnvelope };
  }
  return { type: 'unknown' };
}

/** Who and where, on every event. `enterpriseId` is set for Enterprise Grid installs. */
export interface SlackEventOrigin {
  eventId: string;
  teamId: string | null;
  enterpriseId: string | null;
  /** The bot's own user id in this workspace, from `authorizations`. */
  botUserId: string | null;
}

export type SlackInboundEvent =
  | (SlackEventOrigin & {
      kind: 'question';
      /** `mention`: `@bot` in a channel. `dm`: a message in the bot's DM or assistant pane. */
      source: 'mention' | 'dm';
      channelId: string;
      userId: string;
      /** The text with the bot's own mention removed and whitespace trimmed. */
      text: string;
      /** The message's own ts. */
      ts: string;
      /** The thread to reply in: the parent's ts, or the message's own ts at top level. */
      threadTs: string;
      /** The message was posted inside an existing thread. */
      inThread: boolean;
      /** Slack Connect channel shared with another organization. */
      isExtSharedChannel: boolean;
    })
  | (SlackEventOrigin & {
      kind: 'assistant_thread_started';
      channelId: string;
      userId: string;
      threadTs: string;
      /** The channel the user had open when they started the thread, when Slack sends it. */
      contextChannelId: string | null;
    })
  | (SlackEventOrigin & { kind: 'app_uninstalled' })
  | (SlackEventOrigin & { kind: 'tokens_revoked'; botUserIds: string[]; userIds: string[] })
  | (SlackEventOrigin & { kind: 'ignored'; reason: string });

/** Normalize an Events API envelope. */
export function normalizeSlackEvent(envelope: SlackEventEnvelope): SlackInboundEvent {
  const event = envelope.event;
  const auth = envelope.authorizations?.[0];
  const origin: SlackEventOrigin = {
    eventId: envelope.event_id,
    teamId: envelope.team_id ?? auth?.team_id ?? event.team ?? null,
    enterpriseId: envelope.enterprise_id ?? auth?.enterprise_id ?? null,
    botUserId: auth?.is_bot === false ? null : (auth?.user_id ?? null),
  };
  const ignored = (reason: string): SlackInboundEvent => ({ ...origin, kind: 'ignored', reason });

  switch (event.type) {
    case 'app_mention':
    case 'message': {
      const source = event.type === 'app_mention' ? 'mention' : 'dm';
      if (source === 'dm' && event.channel_type !== 'im') return ignored('message_not_in_dm');
      if (event.bot_id) return ignored('from_bot');
      if (event.subtype && event.subtype !== 'file_share') return ignored(`subtype_${event.subtype}`);
      if (!event.user || !event.channel || !event.ts) return ignored('missing_fields');
      if (origin.botUserId && event.user === origin.botUserId) return ignored('from_self');
      return {
        ...origin,
        kind: 'question',
        source,
        channelId: event.channel,
        userId: event.user,
        text: stripBotMention(event.text ?? '', origin.botUserId),
        ts: event.ts,
        threadTs: event.thread_ts ?? event.ts,
        inThread: event.thread_ts !== undefined && event.thread_ts !== event.ts,
        isExtSharedChannel: envelope.is_ext_shared_channel === true,
      };
    }
    case 'assistant_thread_started': {
      const thread = event.assistant_thread;
      if (!thread?.user_id || !thread.channel_id || !thread.thread_ts) return ignored('missing_fields');
      return {
        ...origin,
        kind: 'assistant_thread_started',
        channelId: thread.channel_id,
        userId: thread.user_id,
        threadTs: thread.thread_ts,
        contextChannelId: thread.context?.channel_id ?? null,
      };
    }
    case 'app_uninstalled':
      return { ...origin, kind: 'app_uninstalled' };
    case 'tokens_revoked':
      return {
        ...origin,
        kind: 'tokens_revoked',
        botUserIds: event.tokens?.bot ?? [],
        userIds: event.tokens?.oauth ?? [],
      };
    default:
      return ignored(`event_${event.type}`);
  }
}

/**
 * Remove the bot's own `<@U…>` mention. Without a known bot id, a leading
 * mention is removed, since `app_mention` text starts with it.
 */
export function stripBotMention(text: string, botUserId: string | null): string {
  const stripped = botUserId
    ? text.replaceAll(new RegExp(`<@${escapeRegExp(botUserId)}(?:\\|[^>]*)?>`, 'g'), ' ')
    : text.replace(/^\s*<@[A-Z0-9]+(?:\|[^>]*)?>/, ' ');
  return stripped.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
