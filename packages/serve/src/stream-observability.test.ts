import { describe, expect, it, vi } from 'vitest';
import { dataset, dimension, measure } from '@hypequery/datasets';
import { createAPI } from './server/create-api.js';
import type { ServeQueryEvent } from './query-logger.js';
import type { RequestEndEvent, RequestErrorEvent, ServeRequest } from './types.js';
import { isServeStreamBody, streamBody } from './utils/stream-body.js';
import { defineServe } from './server/index.js';
import { startNodeServer } from './adapters/node.js';
import type { AddressInfo } from 'node:net';
import { semanticFixtureBuilder } from './semantic/datasets/utils/semantic-fixture-builder.js';

const rows = Array.from({ length: 6 }, (_, i) => ({ country: `C${i}`, total: i }));

const orders = dataset('orders', {
  source: 'orders',
  dimensions: { country: dimension.string() },
  measures: { total: measure.count('id') },
  limits: { maxResultSize: 100 },
});

function setup(options: { failAfterBatches?: number; stream?: boolean; cors?: boolean } = {}) {
  const onRequestEnd = vi.fn<(event: RequestEndEvent) => void>();
  const onError = vi.fn<(event: RequestErrorEvent) => void>();
  const api = createAPI({
    basePath: '',
    hooks: { onRequestEnd, onError },
    ...(options.cors ? { cors: { origin: ['https://app.example.com'] } } : {}),
    datasets: {
      orders: options.stream === false ? orders : { dataset: orders, stream: { maxRows: 50 } },
    },
    queryBuilder: semanticFixtureBuilder(rows, {
      batchSize: 2,
      failAfterBatches: options.failAfterBatches,
      arrowBytes: new Uint8Array([1, 2, 3]),
    }),
  });
  const events: ServeQueryEvent[] = [];
  api.queryLogger.on(event => events.push(event));
  const request = (accept?: string, extra: Record<string, string> = {}): ServeRequest => ({
    method: 'POST',
    path: '/datasets/orders/query',
    query: {},
    headers: { 'content-type': 'application/json', ...(accept ? { accept } : {}), ...extra },
    body: { dimensions: ['country'] },
  });
  return { api, onRequestEnd, onError, events, request };
}

const header = (headers: Record<string, string> | undefined, name: string) =>
  Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];

describe('streamed response observability', () => {
  it('reports the end of a stream when it finishes, with its full duration', async () => {
    const { api, onRequestEnd, onError, events, request } = setup();
    const response = await api.handler(request('application/x-ndjson'));
    expect(isServeStreamBody(response.body)).toBe(true);

    // Opening the stream is not the end of the request.
    expect(onRequestEnd).not.toHaveBeenCalled();
    expect(events.map(event => event.status)).toEqual(['started']);

    const text = await new Response((response.body as { stream: ReadableStream<Uint8Array> }).stream).text();
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    const end = onRequestEnd.mock.calls[0]![0];
    expect(end.stream).toEqual({
      outcome: 'completed',
      bytes: new TextEncoder().encode(text).byteLength,
      openDurationMs: expect.any(Number),
    });
    expect(end.durationMs).toBeGreaterThanOrEqual(end.stream!.openDurationMs);

    const completed = events.at(-1)!;
    expect(completed.status).toBe('completed');
    expect(completed.responseStatus).toBe(200);
    expect(completed.durationMs).toBe(end.durationMs);
    expect(completed.stream?.outcome).toBe('completed');
  });

  it('routes a mid-stream NDJSON failure to onError and the log, keeping the frame sanitized', async () => {
    const { api, onRequestEnd, onError, events, request } = setup({ failAfterBatches: 1 });
    const response = await api.handler(request('application/x-ndjson'));
    const text = await new Response((response.body as { stream: ReadableStream<Uint8Array> }).stream).text();

    const last = JSON.parse(text.trimEnd().split('\n').at(-1)!);
    expect(last).toEqual({
      type: 'error',
      error: { type: 'QUERY_FAILURE', message: 'The query failed after the response began.' },
    });
    expect(text).not.toContain('DB::Exception');

    expect(onRequestEnd).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const failure = onError.mock.calls[0]![0];
    // The hook gets the original error, not the client's sanitized message.
    expect((failure.error as Error).message).toContain('DB::Exception');
    expect(failure.stream?.outcome).toBe('failed');
    expect(failure.stream?.bytes).toBeGreaterThan(0);

    const logged = events.at(-1)!;
    expect(logged.status).toBe('error');
    expect(logged.responseStatus).toBe(200);
    expect(logged.error?.message).toContain('DB::Exception');
    expect(logged.stream?.outcome).toBe('failed');
  });

  it('routes an erroring custom stream to onError', async () => {
    const onError = vi.fn<(event: RequestErrorEvent) => void>();
    const onRequestEnd = vi.fn<(event: RequestEndEvent) => void>();
    const api = defineServe({
      basePath: '',
      hooks: { onError, onRequestEnd },
      queries: {
        exportBytes: {
          query: async () => streamBody(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
            pull(controller) {
              controller.error(new Error('broke partway'));
            },
          }), 'application/octet-stream'),
        },
      },
    });
    api.route('/export', api.queries.exportBytes);

    const response = await api.handler({ method: 'GET', path: '/export', query: {}, headers: {} });
    await expect(new Response((response.body as { stream: ReadableStream<Uint8Array> }).stream).arrayBuffer())
      .rejects.toThrow('broke partway');
    expect(onRequestEnd).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].stream).toEqual({ outcome: 'failed', bytes: 1, openDurationMs: expect.any(Number) });
  });

  it('reports a stream the Node adapter stopped at its idle timeout as a failure', async () => {
    const onError = vi.fn<(event: RequestErrorEvent) => void>();
    const onRequestEnd = vi.fn<(event: RequestEndEvent) => void>();
    const api = defineServe({
      basePath: '',
      hooks: { onError, onRequestEnd },
      queries: {
        stalls: {
          query: async () => streamBody(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('first\n'));
            },
            pull: () => new Promise<void>(() => undefined),
          }), 'application/x-ndjson'),
        },
      },
    });
    api.route('/stalls', api.queries.stalls);
    const started = await startNodeServer(api.handler, {
      port: 0, hostname: '127.0.0.1', quiet: true, streamIdleTimeout: 50,
    });
    try {
      const { port } = started.server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/stalls`);
      expect(response.status).toBe(200);
      await expect(response.text()).rejects.toThrow();
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      const failure = onError.mock.calls[0]![0];
      expect((failure.error as Error).name).toBe('StreamTimeoutError');
      expect(failure.stream).toMatchObject({ outcome: 'failed', bytes: 6 });
      expect(onRequestEnd).not.toHaveBeenCalled();
    } finally {
      await started.stop();
    }
  });

  it('does not let a slow end hook run a finished stream into the idle timeout', async () => {
    let hookDone = false;
    const onRequestEnd = vi.fn(async (_event: RequestEndEvent) => {
      await new Promise(resolve => setTimeout(resolve, 200));
      hookDone = true;
    });
    const api = defineServe({
      basePath: '',
      hooks: { onRequestEnd },
      queries: {
        lines: {
          query: async () => streamBody(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('a\nb\n'));
              controller.close();
            },
          }), 'application/x-ndjson'),
        },
      },
    });
    api.route('/lines', api.queries.lines);
    const started = await startNodeServer(api.handler, {
      port: 0, hostname: '127.0.0.1', quiet: true, streamIdleTimeout: 50,
    });
    try {
      const { port } = started.server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/lines`);
      // The download completes before the hook does.
      expect(await response.text()).toBe('a\nb\n');
      expect(hookDone).toBe(false);
      expect(onRequestEnd.mock.calls[0]![0].stream?.outcome).toBe('completed');
      await vi.waitFor(() => expect(hookDone).toBe(true));
    } finally {
      await started.stop();
    }
  });

  it('logs a stream opened after the request timed out with the 504 the client got', async () => {
    const onError = vi.fn<(event: RequestErrorEvent) => void>();
    const api = defineServe({
      basePath: '',
      hooks: { onError },
      queries: {
        late: {
          query: async () => {
            await new Promise(resolve => setTimeout(resolve, 80));
            return streamBody(new ReadableStream<Uint8Array>(), 'application/x-ndjson');
          },
        },
      },
    });
    api.route('/late', api.queries.late);
    const events: ServeQueryEvent[] = [];
    api.queryLogger.on(event => events.push(event));
    const started = await startNodeServer(api.handler, {
      port: 0, hostname: '127.0.0.1', quiet: true, requestTimeout: 20,
    });
    try {
      const { port } = started.server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/late`);
      expect(response.status).toBe(504);
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect((onError.mock.calls[0]![0].error as Error).name).toBe('StreamTimeoutError');
      const logged = events.at(-1)!;
      expect(logged.status).toBe('error');
      expect(logged.responseStatus).toBe(504);
    } finally {
      await started.stop();
    }
  });

  it('reports a stream the client abandoned as cancelled', async () => {
    const { api, onRequestEnd, onError, events, request } = setup();
    const response = await api.handler(request('application/x-ndjson'));
    const reader = (response.body as { stream: ReadableStream<Uint8Array> }).stream.getReader();
    await reader.read();
    await reader.cancel();

    expect(onError).not.toHaveBeenCalled();
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
    expect(onRequestEnd.mock.calls[0]![0].stream?.outcome).toBe('cancelled');
    expect(events.at(-1)?.stream?.outcome).toBe('cancelled');
  });

  it('reports an Arrow stream once it ends', async () => {
    const { api, onRequestEnd, request } = setup();
    const response = await api.handler(request('application/vnd.apache.arrow.stream'));
    const bytes = await new Response((response.body as { stream: ReadableStream<Uint8Array> }).stream).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(onRequestEnd.mock.calls[0]![0].stream).toMatchObject({ outcome: 'completed', bytes: 3 });
  });

  it('keeps reporting a JSON page when it is sent', async () => {
    const { api, onRequestEnd, events, request } = setup();
    await api.handler(request());
    expect(onRequestEnd).toHaveBeenCalledTimes(1);
    expect(onRequestEnd.mock.calls[0]![0].stream).toBeUndefined();
    expect(events.at(-1)?.stream).toBeUndefined();
  });
});

describe('Vary on streaming-capable dataset endpoints', () => {
  it('varies on Accept for both a page and a stream', async () => {
    const { api, request } = setup();
    const page = await api.handler(request());
    expect(header(page.headers, 'vary')).toBe('Accept');
    const streamed = await api.handler(request('application/x-ndjson'));
    expect(header(streamed.headers, 'vary')).toBe('Accept');
    await (streamed.body as { stream: ReadableStream<Uint8Array> }).stream.cancel();
  });

  it('combines with the Vary CORS adds', async () => {
    const { api, request } = setup({ cors: true });
    const page = await api.handler(request(undefined, { origin: 'https://app.example.com' }));
    expect(header(page.headers, 'vary')).toBe('Accept, Origin');
    expect(Object.keys(page.headers ?? {}).filter(key => key.toLowerCase() === 'vary')).toHaveLength(1);
  });

  it('is absent when the endpoint does not stream', async () => {
    const { api, request } = setup({ stream: false });
    const page = await api.handler(request());
    expect(header(page.headers, 'vary')).toBeUndefined();
  });
});
