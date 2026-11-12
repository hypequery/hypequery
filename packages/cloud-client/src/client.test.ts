import { describe, expect, it, vi } from 'vitest';
import { CloudApiError, createCloudClient, OPERATIONS, type CloudClientOptions } from './index.js';

type Call = { url: URL; init: RequestInit };

function mockFetch(respond: (call: Call) => Response | Promise<Response> = () => Response.json({})) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: new URL(String(url)), init };
    calls.push(call);
    return respond(call);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function client(fetch: typeof globalThis.fetch, options: Partial<CloudClientOptions> = {}) {
  return createCloudClient({ token: 'hqmt_v1_test', baseUrl: 'https://cloud.test/', fetch, ...options });
}

const DRAFT = '0b7c1a1e-1f1c-4c4e-9a7e-2a6f3d1c9b10';

describe('requests', () => {
  it('sends GET input (minus path params) as the query string', async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ releases: [], nextBefore: null }));
    const result = await client(fetch).releases.list({ project: 'shop', limit: 5, before: undefined });
    expect(result).toEqual({ releases: [], nextBefore: null });
    const [call] = calls;
    expect(call!.init.method).toBe('GET');
    expect(call!.url.origin + call!.url.pathname).toBe('https://cloud.test/v1/projects/shop/releases');
    expect([...call!.url.searchParams]).toEqual([['limit', '5']]);
    expect(call!.init.body).toBeUndefined();
  });

  it('sends POST/PATCH/PUT input as a JSON body without path params', async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ name: 'Shop 2', slug: 'shop' }));
    await client(fetch).projects.rename({ project: 'shop', name: 'Shop 2' });
    const [call] = calls;
    expect(call!.init.method).toBe('PATCH');
    expect(call!.url.toString()).toBe('https://cloud.test/v1/projects/shop');
    expect(JSON.parse(String(call!.init.body))).toEqual({ name: 'Shop 2' });
    expect((call!.init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('sends an empty JSON body for a POST with no body fields', async () => {
    const { fetch, calls } = mockFetch();
    await client(fetch).connections.link({ project: 'shop' });
    expect(calls[0]!.init.body).toBe('{}');
  });

  it('encodes path params', async () => {
    const { fetch, calls } = mockFetch();
    await client(fetch).members.cancelInvitation({ invitation: 'a/b c', confirm: true });
    expect(calls[0]!.url.pathname).toBe('/v1/org/members/invitations/a%2Fb%20c');
  });

  it('sends confirm=true in the query string for a destructive DELETE', async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ deleted: true }));
    await client(fetch).drafts.delete({ project: 'shop', draft: DRAFT, confirm: true });
    const [call] = calls;
    expect(call!.init.method).toBe('DELETE');
    expect(call!.url.pathname).toBe(`/v1/projects/shop/drafts/${DRAFT}`);
    expect(call!.url.searchParams.get('confirm')).toBe('true');
  });

  it('sends confirm: true in the body for a destructive POST', async () => {
    const { fetch, calls } = mockFetch();
    await client(fetch).releases.rollback({
      project: 'shop',
      version: 'v3',
      expectedRevision: 'a'.repeat(64),
      confirm: true,
    });
    expect(calls[0]!.url.pathname).toBe('/v1/projects/shop/releases/v3/rollback');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ expectedRevision: 'a'.repeat(64), confirm: true });
  });

  it('authenticates with the bearer token and keeps caller headers', async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ projects: [] }));
    await client(fetch, { headers: { 'User-Agent': 'hypequery-cli/1', Authorization: 'Bearer nope' } }).projects.list(
      undefined,
      { headers: { 'x-trace': '1' } },
    );
    expect(calls[0]!.init.headers).toEqual({
      accept: 'application/json',
      'user-agent': 'hypequery-cli/1',
      'x-trace': '1',
      authorization: 'Bearer hqmt_v1_test',
    });
  });

  it('reads a token function before every request', async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ projects: [] }));
    let n = 0;
    const cloud = client(fetch, { token: async () => `t${++n}` });
    await cloud.projects.list();
    await cloud.projects.list();
    expect(calls.map((c) => (c.init.headers as Record<string, string>).authorization)).toEqual(['Bearer t1', 'Bearer t2']);
  });

  it('defaults to https://cloud.hypequery.com', async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ projects: [] }));
    await createCloudClient({ token: 't', fetch }).projects.list();
    expect(calls[0]!.url.toString()).toBe('https://cloud.hypequery.com/v1/projects');
  });

  it('keeps a base URL path prefix', async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ projects: [] }));
    await client(fetch, { baseUrl: 'http://localhost:3000/cloud' }).projects.list();
    expect(calls[0]!.url.toString()).toBe('http://localhost:3000/cloud/v1/projects');
  });

  it('call() reaches the same operation by name', async () => {
    const { fetch, calls } = mockFetch(() => Response.json({ name: 'Shop', slug: 'shop', live: true, currentRevision: null }));
    await client(fetch).call('projects.get', { project: 'shop' });
    expect(calls[0]!.url.pathname).toBe('/v1/projects/shop');
    await expect(client(fetch).call('nope.nope' as never, undefined as never)).rejects.toThrow(/Unknown Cloud operation/);
  });

  it('exposes every operation as a method', () => {
    const cloud = client(mockFetch().fetch) as unknown as Record<string, Record<string, unknown>>;
    for (const name of Object.keys(OPERATIONS)) {
      const [resource, verb] = name.split('.') as [string, string];
      expect(typeof cloud[resource]?.[verb]).toBe('function');
    }
  });

  it('refuses a missing path param or a non-scalar query value before sending', async () => {
    const { fetch, calls } = mockFetch();
    await expect(client(fetch).projects.get({ project: '' })).rejects.toThrow(/"project" is required/);
    await expect(client(fetch).logs.query({ project: 'shop', range: ['1h'] as never })).rejects.toThrow(
      /query string/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('errors', () => {
  const envelope = {
    error: {
      code: 'INVALID_INPUT',
      message: 'The input for projects.create is invalid.',
      hint: 'Fix the fields listed in `issues`, then retry.',
      docsUrl: 'https://hypequery.com/docs/errors/invalid-input',
      category: 'correctable_input',
      retryable: false,
      correctable: true,
      requestId: 'req_body',
      issues: [{ path: 'slug', message: 'Too short' }],
    },
  };

  it('turns the error envelope into a CloudApiError', async () => {
    const { fetch } = mockFetch(() =>
      Response.json(envelope, { status: 400, headers: { 'x-hypequery-request-id': 'req_header' } }),
    );
    const error = await client(fetch).projects.create({ name: 'Shop' } as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudApiError);
    expect(error).toMatchObject({
      name: 'CloudApiError',
      operation: 'projects.create',
      code: 'INVALID_INPUT',
      message: 'The input for projects.create is invalid.',
      status: 400,
      hint: 'Fix the fields listed in `issues`, then retry.',
      docsUrl: 'https://hypequery.com/docs/errors/invalid-input',
      category: 'correctable_input',
      retryable: false,
      correctable: true,
      requestId: 'req_body',
      issues: [{ path: 'slug', message: 'Too short' }],
    });
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({ code: 'INVALID_INPUT', requestId: 'req_body' });
  });

  it('falls back to the request id header', async () => {
    const { fetch } = mockFetch(() =>
      Response.json(
        { error: { code: 'CONFIRMATION_REQUIRED', message: 'needs confirmation', category: 'correctable_input' } },
        { status: 400, headers: { 'x-hypequery-request-id': 'req_header' } },
      ),
    );
    const error = (await client(fetch)
      .tenants.remove({ project: 'shop', tenant: DRAFT, confirm: true })
      .catch((e: unknown) => e)) as CloudApiError;
    expect(error.requestId).toBe('req_header');
    expect(error.correctable).toBe(true);
    expect(error.issues).toBeUndefined();
    expect(error.hint).toBeUndefined();
  });

  it('reports a non-envelope failure as UNEXPECTED_RESPONSE', async () => {
    const { fetch } = mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = (await client(fetch).projects.list().catch((e: unknown) => e)) as CloudApiError;
    expect(error).toMatchObject({ code: 'UNEXPECTED_RESPONSE', status: 502, retryable: true, category: 'unavailable' });
  });

  it('reports a 200 that is not JSON as UNEXPECTED_RESPONSE', async () => {
    const { fetch } = mockFetch(() => new Response('ok', { status: 200 }));
    await expect(client(fetch).projects.list()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE', retryable: false });
  });

  it('wraps a network failure as a retryable NETWORK_ERROR', async () => {
    const cause = new TypeError('fetch failed');
    const fetch = (async () => {
      throw cause;
    }) as unknown as typeof globalThis.fetch;
    const error = (await client(fetch).projects.list().catch((e: unknown) => e)) as CloudApiError;
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', retryable: true, status: undefined });
    expect(error.cause).toBe(cause);
  });

  it('wraps a connection drop while reading the body as NETWORK_ERROR', async () => {
    const cause = new TypeError('terminated');
    const { fetch } = mockFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"projects":'));
              controller.error(cause);
            },
          }),
          { status: 200 },
        ),
    );
    const error = (await client(fetch).projects.list().catch((e: unknown) => e)) as CloudApiError;
    expect(error).toBeInstanceOf(CloudApiError);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });

  it('rethrows an abort unchanged', async () => {
    const controller = new AbortController();
    const fetch = (async (_url: string, init: RequestInit) => {
      controller.abort();
      init.signal!.throwIfAborted();
      return Response.json({});
    }) as unknown as typeof globalThis.fetch;
    const error = await client(fetch).projects.list(undefined, { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(CloudApiError);
    expect((error as Error).name).toBe('AbortError');
  });
});
