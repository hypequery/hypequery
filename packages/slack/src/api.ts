/**
 * A minimal Slack Web API client: the handful of methods a hypequery bot
 * needs, over `fetch`, with no dependency on `@slack/web-api`.
 */

export type SlackFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface SlackClientOptions {
  /** A bot token (`xoxb-`), or an app-level token (`xapp-`) for `apps.connections.open`. */
  token: string;
  fetch?: SlackFetch;
  /** @default 'https://slack.com/api/' */
  baseUrl?: string;
  /** Retries after HTTP 429, waiting `Retry-After` (at most 30 s each). @default 2 */
  maxRetries?: number;
}

export class SlackApiError extends Error {
  readonly method: string;
  /** Slack's error code, such as `channel_not_found` or `ratelimited`. */
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(method: string, code: string, status: number, retryAfterSeconds: number | null = null) {
    super(`Slack ${method} failed: ${code}`);
    this.name = 'SlackApiError';
    this.method = method;
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface SlackMessageArgs {
  channel: string;
  text: string;
  blocks?: unknown[];
  thread_ts?: string;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  [key: string]: unknown;
}

export interface SlackSuggestedPrompt {
  title: string;
  message: string;
}

export interface SlackThreadMessage {
  type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
}

export interface SlackClient {
  /** Call any Web API method. Arguments are form-encoded; objects and arrays are sent as JSON strings. */
  call<T = Record<string, unknown>>(method: string, args?: Record<string, unknown>): Promise<T & { ok: true }>;
  postMessage(args: SlackMessageArgs): Promise<{ ok: true; ts: string; channel: string }>;
  postEphemeral(args: SlackMessageArgs & { user: string }): Promise<{ ok: true; message_ts: string }>;
  updateMessage(args: Omit<SlackMessageArgs, 'thread_ts'> & { ts: string }): Promise<{ ok: true; ts: string }>;
  /** The assistant pane's "is thinking…" line. An empty status clears it. */
  setAssistantStatus(args: { channel_id: string; thread_ts: string; status: string }): Promise<{ ok: true }>;
  setSuggestedPrompts(args: {
    channel_id: string;
    thread_ts: string;
    prompts: SlackSuggestedPrompt[];
    title?: string;
  }): Promise<{ ok: true }>;
  setThreadTitle(args: { channel_id: string; thread_ts: string; title: string }): Promise<{ ok: true }>;
  /** Messages in a thread, oldest first, parent included. Follows pagination up to `limit`. */
  threadReplies(args: { channel: string; ts: string; limit?: number }): Promise<SlackThreadMessage[]>;
}

export function createSlackClient(options: SlackClientOptions): SlackClient {
  if (!options.token) throw new TypeError('createSlackClient: token is required');
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? 'https://slack.com/api/';
  const maxRetries = options.maxRetries ?? 2;

  async function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T & { ok: true }> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined) continue;
      body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }

    for (let attempt = 0; ; attempt++) {
      const response = await doFetch(new URL(method, baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        },
        body,
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after') ?? 1) || 1;
        if (attempt < maxRetries) {
          await sleep(Math.min(retryAfter, 30) * 1000);
          continue;
        }
        throw new SlackApiError(method, 'ratelimited', 429, retryAfter);
      }

      const json = (await response.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
      if (!json || json.ok !== true) {
        throw new SlackApiError(method, json?.error ?? `http_${response.status}`, response.status);
      }
      return json as T & { ok: true };
    }
  }

  return {
    call,
    postMessage: args => call('chat.postMessage', args),
    postEphemeral: args => call('chat.postEphemeral', args),
    updateMessage: args => call('chat.update', args),
    setAssistantStatus: args => call('assistant.threads.setStatus', args),
    setSuggestedPrompts: args => call('assistant.threads.setSuggestedPrompts', args),
    setThreadTitle: args => call('assistant.threads.setTitle', args),
    async threadReplies({ channel, ts, limit = 200 }) {
      const messages: SlackThreadMessage[] = [];
      let cursor: string | undefined;
      do {
        const page = await call<{ messages?: SlackThreadMessage[]; response_metadata?: { next_cursor?: string } }>(
          'conversations.replies',
          { channel, ts, cursor, limit: Math.min(limit - messages.length, 200) },
        );
        messages.push(...(page.messages ?? []));
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor && messages.length < limit);
      return messages.slice(0, limit);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
