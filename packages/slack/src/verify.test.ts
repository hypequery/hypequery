import { describe, expect, it } from 'vitest';
import { signSlackRequest, verifySlackRequest } from './verify.js';

const secret = '8f742231b10e8888abcd99yyyzzz85a5';
const now = 1_731_600_000_000;
const ts = String(now / 1000);
const body = 'token=xyz&team_id=T1&command=%2Fask&text=revenue';

describe('verifySlackRequest', () => {
  it('matches Slack\'s documented example signature', async () => {
    const example =
      'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
    const signature = await signSlackRequest(secret, '1531420618', example);
    expect(signature).toBe('v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503');
  });

  it('accepts a correctly signed, fresh request', async () => {
    const signature = await signSlackRequest(secret, ts, body);
    expect(await verifySlackRequest({ signingSecret: secret, body, timestamp: ts, signature, now })).toEqual({ ok: true });
  });

  it('rejects a tampered body', async () => {
    const signature = await signSlackRequest(secret, ts, body);
    const result = await verifySlackRequest({ signingSecret: secret, body: body + 'x', timestamp: ts, signature, now });
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects the wrong secret', async () => {
    const signature = await signSlackRequest('other', ts, body);
    const result = await verifySlackRequest({ signingSecret: secret, body, timestamp: ts, signature, now });
    expect(result.ok).toBe(false);
  });

  it('rejects requests outside the replay window', async () => {
    const old = String(now / 1000 - 301);
    const signature = await signSlackRequest(secret, old, body);
    const result = await verifySlackRequest({ signingSecret: secret, body, timestamp: old, signature, now });
    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects missing headers, bad timestamps and a missing secret', async () => {
    expect(await verifySlackRequest({ signingSecret: secret, body, timestamp: null, signature: 'v0=1', now })).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    expect(await verifySlackRequest({ signingSecret: secret, body, timestamp: '1e9', signature: 'v0=1', now })).toEqual({
      ok: false,
      reason: 'invalid_timestamp',
    });
    expect(await verifySlackRequest({ signingSecret: '', body, timestamp: ts, signature: 'v0=1', now })).toEqual({
      ok: false,
      reason: 'missing_signing_secret',
    });
    expect(await verifySlackRequest({ signingSecret: secret, body, timestamp: ts, signature: 'v1=abc', now })).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });
});
