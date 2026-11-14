import { describe, expect, it, vi } from 'vitest';
import { createSlackClient, SlackApiError } from './api.js';

function fetchReturning(...responses: Response[]) {
  const fn = vi.fn(async (_url: string | URL, _init?: RequestInit) => responses.shift()!);
  return fn;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

describe('createSlackClient', () => {
  it('form-encodes arguments, JSON-encodes objects and sends the bearer token', async () => {
    const fetch = fetchReturning(json({ ok: true, ts: '1.0', channel: 'C1' }));
    const client = createSlackClient({ token: 'xoxb-1', fetch });
    await client.postMessage({ channel: 'C1', text: 'hi', blocks: [{ type: 'divider' }], thread_ts: undefined });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://slack.com/api/chat.postMessage');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer xoxb-1');
    const body = init!.body as URLSearchParams;
    expect(body.get('channel')).toBe('C1');
    expect(body.get('blocks')).toBe('[{"type":"divider"}]');
    expect(body.has('thread_ts')).toBe(false);
  });

  it('throws SlackApiError with Slack\'s error code', async () => {
    const client = createSlackClient({ token: 'xoxb-1', fetch: fetchReturning(json({ ok: false, error: 'channel_not_found' })) });
    await expect(client.postMessage({ channel: 'C1', text: 'x' })).rejects.toMatchObject({
      name: 'SlackApiError',
      code: 'channel_not_found',
      method: 'chat.postMessage',
    });
  });

  it('retries after a 429 and gives up after maxRetries', async () => {
    vi.useFakeTimers();
    try {
      const limited = () => new Response('', { status: 429, headers: { 'retry-after': '1' } });
      const fetch = fetchReturning(limited(), json({ ok: true }));
      const client = createSlackClient({ token: 'xoxb-1', fetch });
      const call = client.call('auth.test');
      await vi.advanceTimersByTimeAsync(1000);
      await expect(call).resolves.toEqual({ ok: true });

      const failing = createSlackClient({ token: 'xoxb-1', fetch: fetchReturning(limited()), maxRetries: 0 });
      await expect(failing.call('auth.test')).rejects.toBeInstanceOf(SlackApiError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows conversations.replies pagination', async () => {
    const fetch = fetchReturning(
      json({ ok: true, messages: [{ ts: '1' }], response_metadata: { next_cursor: 'c2' } }),
      json({ ok: true, messages: [{ ts: '2' }], response_metadata: { next_cursor: '' } }),
    );
    const client = createSlackClient({ token: 'xoxb-1', fetch });
    expect(await client.threadReplies({ channel: 'C1', ts: '1' })).toEqual([{ ts: '1' }, { ts: '2' }]);
    expect((fetch.mock.calls[1]![1]!.body as URLSearchParams).get('cursor')).toBe('c2');
  });
});
