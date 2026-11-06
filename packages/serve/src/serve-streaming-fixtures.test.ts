import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure } from '@hypequery/datasets';
import { createAPI } from './server/create-api.js';
import { AuthError, createBearerTokenStrategy } from './auth.js';
import { isServeStreamBody } from './utils/stream-body.js';
import { semanticFixtureBuilder } from './semantic/datasets/utils/semantic-fixture-builder.js';

interface FixtureCase {
  id: string;
  accept?: string;
  credential?: 'valid' | 'none';
  stream?: boolean;
  failAfterBatches?: number;
  json: unknown;
  expect: {
    status: number;
    contentType: string;
    rows?: unknown[];
    batches?: number;
    end?: { rowCount: number };
    meta?: boolean;
    errorFrame?: string;
    forbiddenText?: string[];
    bodyBase64?: string;
    data?: unknown[];
    errorType?: string;
  };
}

const fixtures = JSON.parse(readFileSync(new URL(
  '../../../specs/serve-http/fixtures/streaming-v1/cases.json', import.meta.url,
), 'utf8')) as {
  app: {
    credential: string; dataset: string; source: string; dimension: string; column: string;
    measure: string; measureField: string; maxResultSize: number; pageCap: number;
    streamMaxRows: number; batchSize: number; rows: Array<Record<string, unknown>>;
    arrowBytesBase64: string;
  };
  forbiddenPublicKeys: string[];
  cases: FixtureCase[];
};

function assertPublic(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(assertPublic); return; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expect(fixtures.forbiddenPublicKeys).not.toContain(key);
      assertPublic(child);
    }
  }
}

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('shared streaming HTTP fixtures (streaming-v1)', () => {
  it.each(fixtures.cases)('$id', async fixture => {
    const config = fixtures.app;
    const orders = dataset(config.dataset, {
      source: config.source,
      dimensions: { [config.dimension]: dimension.string({ column: config.column }) },
      measures: { [config.measure]: measure.count(config.measureField) },
      limits: { maxResultSize: config.maxResultSize },
    });
    const api = createAPI({
      basePath: '',
      auth: createBearerTokenStrategy({ validate: token => {
        if (token !== config.credential) throw new AuthError('INVALID', 'Invalid token');
        return { userId: 'alice' };
      } }),
      datasets: { [config.dataset]: {
        dataset: orders,
        maxLimit: config.pageCap,
        ...(fixture.stream === false ? {} : { stream: { maxRows: config.streamMaxRows } }),
      } },
      queryBuilder: semanticFixtureBuilder(config.rows, {
        batchSize: config.batchSize,
        failAfterBatches: fixture.failAfterBatches,
        arrowBytes: Buffer.from(config.arrowBytesBase64, 'base64'),
      }),
    });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (fixture.accept) headers.accept = fixture.accept;
    if (fixture.credential !== 'none') headers.authorization = `Bearer ${config.credential}`;

    const response = await api.handler({
      method: 'POST', path: `/datasets/${config.dataset}/query`, headers, query: {}, body: fixture.json,
    });
    const expected = fixture.expect;
    expect(response.status).toBe(expected.status);
    const header = (name: string) => Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
    expect(header('cache-control')).toBe('no-store');
    expect(header('x-request-id')).toBeTruthy();

    if (!isServeStreamBody(response.body)) {
      expect(expected.contentType).toBe('application/json');
      const body = JSON.parse(JSON.stringify(response.body));
      assertPublic(body);
      if (expected.data) expect(body.data).toEqual(expected.data);
      if (expected.errorType) expect(body.error.type).toBe(expected.errorType);
      return;
    }

    expect(response.body.contentType).toBe(expected.contentType);
    const bytes = await readBytes(response.body.stream);
    if (expected.bodyBase64) {
      expect(bytes.toString('base64')).toBe(expected.bodyBase64);
      return;
    }

    const text = bytes.toString('utf8');
    for (const forbidden of expected.forbiddenText ?? []) expect(text).not.toContain(forbidden);
    expect(text.endsWith('\n')).toBe(true);
    const frames = text.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, any>);
    assertPublic(frames);
    expect(frames[0]!.type).toBe('start');
    if (expected.meta === false) expect(frames[0]!.meta).toBeUndefined();
    if (expected.meta === true) expect(frames[0]!.meta).toEqual(expect.any(Object));
    const rowFrames = frames.filter(frame => frame.type === 'rows');
    expect(frames.slice(1, 1 + rowFrames.length).every(frame => frame.type === 'rows')).toBe(true);
    expect(rowFrames.flatMap(frame => frame.data)).toEqual(expected.rows);
    if (expected.batches !== undefined) expect(rowFrames).toHaveLength(expected.batches);
    const last = frames.at(-1)!;
    expect(frames).toHaveLength(rowFrames.length + 2);
    if (expected.end) expect(last).toEqual({ type: 'end', ...expected.end });
    if (expected.errorFrame) {
      expect(last.type).toBe('error');
      expect(last.error.type).toBe(expected.errorFrame);
      expect(frames.some(frame => frame.type === 'end')).toBe(false);
    }
  });

  it('allows a stream cap up to the dataset\'s maxStreamRows', () => {
    const orders = dataset('orders', {
      source: 'orders',
      dimensions: { country: dimension.string() },
      measures: { total: measure.count('id') },
      limits: { maxResultSize: 10, maxStreamRows: 1000 },
    });
    const api = (maxRows: number) => createAPI({
      basePath: '',
      datasets: { orders: { dataset: orders, stream: { maxRows } } },
      queryBuilder: semanticFixtureBuilder([]),
    });
    expect(() => api(1000)).not.toThrow();
    expect(() => api(1001)).toThrow('stream.maxRows (1001) exceeds the dataset\'s limits.maxStreamRows (1000)');
  });

  it('streams past maxResultSize up to maxStreamRows, while pages keep maxResultSize', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ country: `C${i}`, total: i }));
    const orders = dataset('orders', {
      source: 'orders',
      dimensions: { country: dimension.string() },
      measures: { total: measure.count('id') },
      limits: { maxResultSize: 10, maxStreamRows: 25 },
    });
    const api = createAPI({
      basePath: '',
      datasets: { orders: { dataset: orders, stream: { maxRows: 25 } } },
      queryBuilder: semanticFixtureBuilder(rows, { batchSize: 10 }),
    });
    const post = (accept?: string, limit?: number) => api.handler({
      method: 'POST', path: '/datasets/orders/query', query: {},
      headers: { 'content-type': 'application/json', ...(accept ? { accept } : {}) },
      body: { dimensions: ['country'], ...(limit === undefined ? {} : { limit }) },
    });

    const streamed = await post('application/x-ndjson', 20);
    expect(streamed.status).toBe(200);
    const text = await new Response((streamed.body as { stream: ReadableStream<Uint8Array> }).stream).text();
    expect(JSON.parse(text.trimEnd().split('\n').at(-1)!)).toEqual({ type: 'end', rowCount: 20 });

    const page = await post(undefined, 20);
    expect((page.body as { data: unknown[] }).data).toHaveLength(10);
  });

  it('refuses a stream cap above the dataset ceiling at startup', () => {
    const orders = dataset('orders', {
      source: 'orders',
      dimensions: { country: dimension.string() },
      measures: { total: measure.count('id') },
      limits: { maxResultSize: 10 },
    });
    expect(() => createAPI({
      basePath: '',
      datasets: { orders: { dataset: orders, stream: { maxRows: 11 } } },
      queryBuilder: semanticFixtureBuilder([]),
    })).toThrow('stream.maxRows (11) exceeds the dataset\'s limits.maxResultSize (10)');
  });
});
