import { describe, expect, it, vi } from 'vitest';
import { createSlackRequestHandler } from './http.js';
import { signSlackRequest } from './verify.js';
import { BOT, envelope } from './fixtures.test-utils.js';

const secret = 'test-secret';

async function signed(body: string, headers: Record<string, string> = {}, contentType = 'application/json') {
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request('https://bot.example/slack/events', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-request-timestamp': ts,
      'x-slack-signature': await signSlackRequest(secret, ts, body),
      ...headers,
    },
    body,
  });
}

const mention = JSON.stringify(envelope({ type: 'app_mention', user: 'U1', channel: 'C1', ts: '1.0', text: `<@${BOT}> hi` }));

describe('createSlackRequestHandler', () => {
  it('answers url_verification', async () => {
    const handler = createSlackRequestHandler({ signingSecret: secret });
    const response = await handler(await signed(JSON.stringify({ type: 'url_verification', challenge: 'c1' })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: 'c1' });
  });

  it('rejects unsigned requests and wrong methods', async () => {
    const handler = createSlackRequestHandler({ signingSecret: secret });
    const unsigned = await handler(new Request('https://bot.example', { method: 'POST', body: mention }));
    expect(unsigned.status).toBe(401);
    const get = await handler(new Request('https://bot.example'));
    expect(get.status).toBe(405);
  });

  it('rejects oversized bodies before verifying', async () => {
    const handler = createSlackRequestHandler({ signingSecret: secret, maxBodyBytes: 10 });
    expect((await handler(await signed(mention))).status).toBe(413);
  });

  it('stops reading an undeclared-length body once it passes the limit', async () => {
    const handler = createSlackRequestHandler({ signingSecret: secret, maxBodyBytes: 1_000 });
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(400));
      },
    });
    const request = new Request('https://bot.example/slack/events', {
      method: 'POST',
      body: endless,
      // @ts-expect-error Node's fetch needs duplex for a stream body.
      duplex: 'half',
    });
    expect(request.headers.get('content-length')).toBeNull();
    expect((await handler(request)).status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });

  it('acks before the handler finishes and hands the work to waitUntil', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const onEvent = vi.fn(() => gate);
    const pending: Promise<unknown>[] = [];
    const handler = createSlackRequestHandler({ signingSecret: secret, onEvent, waitUntil: work => pending.push(work) });

    const response = await handler(await signed(mention));
    expect(response.status).toBe(200);
    expect(pending).toHaveLength(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'question', text: 'hi' }),
      expect.objectContaining({ retry: null }),
    );
    release();
    await Promise.all(pending);
  });

  it('runs each event id once, even when Slack retries', async () => {
    const onEvent = vi.fn();
    const pending: Promise<unknown>[] = [];
    const handler = createSlackRequestHandler({ signingSecret: secret, onEvent, waitUntil: work => pending.push(work) });

    await handler(await signed(mention));
    const retry = await handler(await signed(mention, { 'x-slack-retry-num': '1', 'x-slack-retry-reason': 'http_timeout' }));
    await Promise.all(pending);
    expect(retry.status).toBe(200);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('passes retry info for a first-seen retried event', async () => {
    const onEvent = vi.fn();
    const pending: Promise<unknown>[] = [];
    const handler = createSlackRequestHandler({ signingSecret: secret, onEvent, waitUntil: work => pending.push(work) });
    await handler(await signed(mention, { 'x-slack-retry-num': '2', 'x-slack-retry-reason': 'http_error' }));
    await Promise.all(pending);
    expect(onEvent.mock.calls[0]![1]).toMatchObject({ retry: { attempt: 2, reason: 'http_error' } });
  });

  it('does not call onEvent for ignored events', async () => {
    const onEvent = vi.fn();
    const handler = createSlackRequestHandler({ signingSecret: secret, onEvent });
    const fromBot = JSON.stringify(envelope({ type: 'app_mention', user: 'U1', bot_id: 'B1', channel: 'C1', ts: '1.0' }));
    expect((await handler(await signed(fromBot))).status).toBe(200);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reports handler errors to onError instead of failing the request', async () => {
    const onError = vi.fn();
    const pending: Promise<unknown>[] = [];
    const handler = createSlackRequestHandler({
      signingSecret: secret,
      onEvent: () => {
        throw new Error('boom');
      },
      onError,
      waitUntil: work => pending.push(work),
    });
    expect((await handler(await signed(mention))).status).toBe(200);
    await Promise.all(pending);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { eventId: 'Ev1' });
  });

  it('routes slash commands', async () => {
    const onCommand = vi.fn();
    const pending: Promise<unknown>[] = [];
    const handler = createSlackRequestHandler({ signingSecret: secret, onCommand, waitUntil: work => pending.push(work) });
    await handler(await signed('command=%2Fask&text=hi&user_id=U1', {}, 'application/x-www-form-urlencoded'));
    await Promise.all(pending);
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ command: '/ask', text: 'hi' }));
  });

  it('requires a signing secret', () => {
    expect(() => createSlackRequestHandler({ signingSecret: '' })).toThrow(TypeError);
  });
});
