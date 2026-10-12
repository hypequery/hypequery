import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import fixture from './published-canary.fixture.json';
import { handleTelemetry } from './handler';
import { telemetryConfig } from './config';
import { forwardTelemetry, posthogBatch } from './forward';
import { firewallRateLimit, TELEMETRY_RATE_LIMIT_ID, type RateLimiter } from './rate-limit';
import { validateBatch } from './validation';

const env = { POSTHOG_PROJECT_TOKEN: 'phc_test', TELEMETRY_PROJECT_HMAC_SECRET: 'a'.repeat(64) };
const allow: RateLimiter = async () => 'allowed';
function handle(input: Request, schedule: Parameters<typeof handleTelemetry>[1], config: Record<string, string | undefined> = env, rateLimit = allow) {
  return handleTelemetry(input, schedule, config, rateLimit);
}
function request(body: unknown = fixture, headers: Record<string, string> = {}) {
  return new Request('https://hypequery.com/api/telemetry', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

test('accepts the actual published canary dev lifecycle and responds before forwarding', async () => {
  let scheduled: (() => Promise<void>) | undefined;
  const response = await handle(request(), callback => { scheduled = callback; }, env);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(typeof scheduled, 'function');
  assert.equal(validateBatch(fixture), true);
});

test('fails closed without server credentials or with insecure/invalid hosts', async () => {
  for (const config of [{}, { ...env, TELEMETRY_PROJECT_HMAC_SECRET: 'short' },
    { ...env, POSTHOG_HOST: 'http://posthog.com' }, { ...env, POSTHOG_HOST: 'https://user:pass@posthog.com' },
    { ...env, POSTHOG_HOST: 'https://posthog.com/path' }, { ...env, POSTHOG_HOST: 'https://posthog.com?token=x' }]) {
    assert.equal((await handle(request(), () => assert.fail('scheduled'), config)).status, 503);
  }
  assert.equal(telemetryConfig({ ...env, POSTHOG_HOST: 'https://eu.i.posthog.com' })?.host, 'https://eu.i.posthog.com');
});

test('rejects unknown or identifying data, invalid IDs, flags, schema and timestamps without scheduling', async () => {
  const mutations: ((body: typeof fixture) => void)[] = [
    body => { Object.assign(body, { secret: 'private' }); },
    body => { Object.assign(body.batch[0], { ip: '1.2.3.4' }); },
    body => { Object.assign(body.batch[0].properties, { sql: 'select private' }); },
    body => { Object.assign(body.batch[0].properties.hypequery_packages, { 'private-package': '1.0.0' }); },
    body => { body.batch[0].distinct_id = 'someone@example.com'; },
    body => { body.batch[0].properties.schema_version = 2; },
    body => { body.batch[0].properties.$geoip_disable = false; },
    body => { body.batch[0].timestamp = '2026-02-31T00:00:00.000Z'; },
    body => { body.batch[0].properties.cli_version = '1.0.0\n'; },
    body => { body.batch[0].event = 'unrecognized'; },
    body => { body.batch.length = 0; },
    body => { body.batch = Array.from({ length: 33 }, () => body.batch[0]); },
  ];
  for (const mutate of mutations) {
    const body = structuredClone(fixture);
    mutate(body);
    assert.equal((await handle(request(body), () => assert.fail('scheduled'), env)).status, 400);
  }
  const completion = structuredClone(fixture.batch.find(event => event.event === 'cli_command_completed')!);
  assert.ok(completion);
  Object.assign(completion.properties, { flags_used: ['scope'] });
  assert.equal(validateBatch({ api_key: 'hypequery-cli', batch: [completion] }), false);
});

test('rejects oversized declared and streamed bodies, malformed JSON and unsupported content', async () => {
  for (const headers of [{ 'content-length': '65537' }, { 'content-length': 'NaN' }]) {
    assert.equal((await handle(request(fixture, headers), () => assert.fail('scheduled'), env)).status, 413);
  }
  const oversized = new Request('https://hypequery.com/api/telemetry', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65537),
  });
  assert.equal((await handle(oversized, () => assert.fail('scheduled'), env)).status, 413);
  const malformed = new Request('https://hypequery.com/api/telemetry', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  });
  assert.equal((await handle(malformed, () => assert.fail('scheduled'), env)).status, 400);
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-encoding': 'gzip' }] as Record<string, string>[]) {
    assert.equal((await handle(request(fixture, headers), () => assert.fail('scheduled'), env)).status, 415);
  }
});

test('returns 410 only for validated explicitly disabled versions', async () => {
  const disabled = { ...env, TELEMETRY_DISABLED_CLI_VERSIONS: fixture.batch[0].properties.cli_version };
  assert.equal((await handle(request(), () => assert.fail('scheduled'), disabled)).status, 410);
  assert.equal((await handle(request({}), () => assert.fail('scheduled'), disabled)).status, 400);
  assert.equal((await handle(request(), () => {}, { ...env, TELEMETRY_DISABLED_CLI_VERSIONS: '1.0.0' })).status, 202);
});

test('accepts the 32-event boundary and rejects the next streamed byte at 64 KiB', async () => {
  const body = { api_key: 'hypequery-cli', batch: Array.from({ length: 32 }, () => fixture.batch[0]) };
  assert.equal((await handle(request(body), () => {}, env)).status, 202);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(65536));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  const streamed = new Request('https://hypequery.com/api/telemetry', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: stream,
    duplex: 'half',
  } as RequestInit);
  assert.equal((await handle(streamed, () => assert.fail('scheduled'), env)).status, 413);
  assert.equal(cancelled, true);
});

test('upstream errors are bounded to one attempt and logs contain no payload or credentials', async () => {
  const messages: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => { messages.push(args); };
  let calls = 0;
  try {
    await forwardTelemetry(fixture.batch, telemetryConfig(env)!, async () => {
      calls++;
      throw new Error('private-token-and-body');
    });
    await forwardTelemetry(fixture.batch, telemetryConfig(env)!, async () => {
      calls++;
      return new Response('private-upstream-body', { status: 503 });
    });
  } finally {
    console.error = original;
  }
  assert.equal(calls, 2);
  assert.deepEqual(messages, [['CLI telemetry forwarding failed'], ['CLI telemetry forwarding failed: upstream status', 503]]);
});

test('forwards PostHog format, rekeys projects and never forwards request IP/cookies', async () => {
  const config = telemetryConfig(env)!;
  const event = structuredClone(fixture.batch[0]);
  Object.assign(event.properties, { project_id: 'b'.repeat(64) });
  const payload = posthogBatch([event], config);
  assert.equal(payload.token, env.POSTHOG_PROJECT_TOKEN);
  assert.equal(payload.batch[0].properties.project_id, createHmac('sha256', config.secret).update('b'.repeat(64)).digest('hex'));
  assert.equal(payload.batch[0].properties.distinct_id, event.distinct_id);
  assert.equal(payload.batch[0].properties.$geoip_disable, true);
  assert.equal(payload.batch[0].properties.$process_person_profile, false);
  assert.equal('project_id' in posthogBatch(fixture.batch, config).batch[0].properties, false);
  let calls = 0;
  await forwardTelemetry([event], config, async (url, options) => {
    calls++;
    assert.equal(url, 'https://us.i.posthog.com/batch/');
    assert.deepEqual(options?.headers, { 'Content-Type': 'application/json' });
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    assert.deepEqual(JSON.parse(options?.body as string), payload);
    return new Response(null, { status: 200 });
  });
  assert.equal(calls, 1);
});

test('rate limits before reading the body and fails closed without a firewall rule', async () => {
  let checked: Request | undefined;
  const limited: RateLimiter = async input => { checked = input; return 'limited'; };
  const body = request();
  const response = await handle(body, () => assert.fail('scheduled'), env, limited);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(checked, body);
  assert.equal(body.bodyUsed, false);
  assert.equal((await handle(request(), () => assert.fail('scheduled'), env, async () => 'unconfigured')).status, 503);
  assert.equal((await handle(request(), () => assert.fail('scheduled'), {}, () => assert.fail('checked'))).status, 503);
});

test('maps Vercel Firewall rate-limit responses', async () => {
  const original = { fetch: globalThis.fetch, nodeEnv: process.env.NODE_ENV, error: console.error, warn: console.warn };
  const urls: string[] = [];
  const errors: unknown[][] = [];
  const respond = (status: number | Error) => {
    globalThis.fetch = async input => {
      urls.push(String(input));
      if (status instanceof Error) throw status;
      return new Response(null, { status });
    };
  };
  const firewallRequest = () => request(fixture, { host: 'hypequery.com', 'x-real-ip': '203.0.113.7' });
  Object.assign(process.env, { NODE_ENV: 'production' });
  console.error = (...args) => { errors.push(args); };
  console.warn = () => {};
  try {
    for (const [status, expected] of [[204, 'allowed'], [429, 'limited'], [403, 'limited'], [404, 'unconfigured'], [500, 'allowed']] as const) {
      respond(status);
      assert.equal(await firewallRateLimit(firewallRequest()), expected, String(status));
    }
    respond(new Error('network'));
    assert.equal(await firewallRateLimit(firewallRequest()), 'allowed');
    assert.equal(urls[0], `https://hypequery.com/.well-known/vercel/rate-limit-api/${TELEMETRY_RATE_LIMIT_ID}`);
    assert.deepEqual(errors, [['CLI telemetry rate limit check failed'], ['CLI telemetry rate limit check failed']]);
  } finally {
    globalThis.fetch = original.fetch;
    Object.assign(process.env, { NODE_ENV: original.nodeEnv });
    if (original.nodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    console.error = original.error;
    console.warn = original.warn;
  }
});
