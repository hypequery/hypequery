import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { clickHouseMessage, createClickHouseHttpQuery, REDIRECT_REFUSED } from './clickhouse-http-query.js';

/** Stands in for the engine's class, which the transport must throw (the engine checks `instanceof`). */
class ClickHouseConnectionError extends Error {
  readonly kind: 'connection' | 'access' | 'query';
  readonly exceptionCode?: number;
  constructor(message: string, exceptionCode?: number, kind: 'connection' | 'access' | 'query' = 'connection') {
    super(message);
    this.name = 'ClickHouseConnectionError';
    this.kind = kind;
    if (exceptionCode !== undefined) this.exceptionCode = exceptionCode;
  }
}

const input = { host: 'http://localhost:8123/', database: 'shop', username: 'reader', password: 's3cret' };
const options = { maxBytes: 1024, timeoutMs: 1000 };

describe('createClickHouseHttpQuery', () => {
  it('posts the SQL with basic auth, the database, settings and parameters in the URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('1\n', { status: 200 }));
    const query = createClickHouseHttpQuery(ClickHouseConnectionError, fetchImpl as unknown as typeof fetch);
    await expect(query(input, 'SELECT 1', { ...options, settings: { readonly: 2 }, params: { dbs: "['a']" } })).resolves.toBe('1\n');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get('database')).toBe('shop');
    expect(url.searchParams.get('readonly')).toBe('2');
    expect(url.searchParams.get('param_dbs')).toBe("['a']");
    expect(init.method).toBe('POST');
    expect(init.body).toBe('SELECT 1');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('reader:s3cret').toString('base64')}`);
    expect(url.toString()).not.toContain('s3cret');
  });

  it('refuses a user name with a colon, which basic auth cannot carry, without sending anything', async () => {
    const fetchImpl = vi.fn();
    const query = createClickHouseHttpQuery(ClickHouseConnectionError, fetchImpl as unknown as typeof fetch);
    await expect(query({ ...input, username: 'team:reader' }, 'SELECT 1', options))
      .rejects.toMatchObject({ kind: 'access', message: expect.stringContaining('basic authentication') });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports ClickHouse errors by kind, with its message', async () => {
    const respond = (status: number, code: string, body: string) => vi.fn(async () => new Response(body, { status, headers: { 'x-clickhouse-exception-code': code } }));
    const denied = createClickHouseHttpQuery(ClickHouseConnectionError, respond(403, '497', 'Code: 497. DB::Exception: reader: Not enough privileges. (ACCESS_DENIED) (version 25.8.1.1 (official build))') as unknown as typeof fetch);
    await expect(denied(input, 'SELECT 1', options)).rejects.toMatchObject({ kind: 'access', exceptionCode: 497, message: 'reader: Not enough privileges. (ACCESS_DENIED)' });
    const failed = createClickHouseHttpQuery(ClickHouseConnectionError, respond(404, '60', 'Code: 60. DB::Exception: Unknown table') as unknown as typeof fetch);
    const error = await failed(input, 'SELECT 1', options).catch(caught => caught);
    expect(error).toBeInstanceOf(ClickHouseConnectionError);
    expect(error).toMatchObject({ kind: 'query', exceptionCode: 60 });
  });

  it('treats a refused connection as retryable connection trouble', async () => {
    const fetchImpl = vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
    const query = createClickHouseHttpQuery(ClickHouseConnectionError, fetchImpl as unknown as typeof fetch);
    await expect(query(input, 'SELECT 1', options)).rejects.toMatchObject({ kind: 'connection', message: expect.stringContaining('refused') });
  });

  it('refuses an oversized response and an exhausted deadline', async () => {
    const big = createClickHouseHttpQuery(ClickHouseConnectionError, vi.fn(async () => new Response('x'.repeat(2048))) as unknown as typeof fetch);
    await expect(big(input, 'SELECT 1', options)).rejects.toMatchObject({ message: 'ClickHouse returned an unexpectedly large response.' });
    const late = createClickHouseHttpQuery(ClickHouseConnectionError, vi.fn() as unknown as typeof fetch);
    await expect(late(input, 'SELECT 1', { ...options, deadlineMs: Date.now() - 1 })).rejects.toMatchObject({ message: expect.stringContaining('time budget') });
  });

  it('aborts a query that runs past its timeout', async () => {
    const fetchImpl = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const query = createClickHouseHttpQuery(ClickHouseConnectionError, fetchImpl as unknown as typeof fetch);
    await expect(query(input, 'SELECT sleep(3)', { maxBytes: 10, timeoutMs: 20 })).rejects.toMatchObject({ kind: 'connection', message: expect.stringContaining('time budget') });
  });

  it('does not follow a redirect, so the credentials never reach the redirect target', async () => {
    const seen: IncomingHttpHeaders[] = [];
    const target = createServer((request, response) => { seen.push(request.headers); response.end('1\n'); });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    const redirector = createServer((_request, response) => {
      response.writeHead(307, { location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/` });
      response.end();
    });
    await new Promise<void>(resolve => redirector.listen(0, '127.0.0.1', resolve));
    try {
      const query = createClickHouseHttpQuery(ClickHouseConnectionError);
      const host = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`;
      await expect(query({ ...input, host }, 'SELECT 1', options)).rejects.toMatchObject({ kind: 'connection', message: REDIRECT_REFUSED });
      expect(seen).toEqual([]);
    } finally {
      await Promise.all([target, redirector].map(server => new Promise(resolve => server.close(resolve))));
    }
  });

  it('asks fetch to fail on redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response('1\n'));
    await createClickHouseHttpQuery(ClickHouseConnectionError, fetchImpl as unknown as typeof fetch)(input, 'SELECT 1', options);
    expect((fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1].redirect).toBe('error');
  });

  it('refuses a URL that is not http(s)', async () => {
    const query = createClickHouseHttpQuery(ClickHouseConnectionError, vi.fn() as unknown as typeof fetch);
    await expect(query({ ...input, host: 'ftp://x' }, 'SELECT 1', options)).rejects.toBeInstanceOf(ClickHouseConnectionError);
  });
});

describe('clickHouseMessage', () => {
  it('keeps the first line without the code prefix or version', () => {
    expect(clickHouseMessage('Code: 81. DB::Exception: Database x does not exist. (UNKNOWN_DATABASE) (version 25.8.33.6 (official build))\nmore')).toBe('Database x does not exist. (UNKNOWN_DATABASE)');
  });

  it('drops terminal control sequences from the server\'s message', () => {
    const message = clickHouseMessage('Code: 60. DB::Exception: Table \u001b[2Jx\u001b]0;title\u0007\u009b31m does not exist. (UNKNOWN_TABLE)');
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(message).toBe('Table [2Jx ]0;title 31m does not exist. (UNKNOWN_TABLE)');
  });
});
