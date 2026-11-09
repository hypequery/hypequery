import { dataset, dimension, measure } from '../semantic/index.js';
import {
  ARROW_STREAM_MEDIA_TYPE,
  NDJSON_MEDIA_TYPE,
  createAPI,
  defineServe,
  isServeStreamBody,
  streamBody,
  type DatasetEntry,
  type RequestEndEvent,
  type RequestErrorEvent,
  type ServeQueryEvent,
  type ServeStreamBody,
  type ServeStreamBodyOptions,
  type ServeStreamInfo,
  type ServeStreamOutcome,
  type StartServerOptions,
} from '../index.js';
import type { QueryBuilderFactoryLike } from '@hypequery/datasets';
import type { Equal, Expect } from '@type-challenges/utils';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { country: dimension.string() },
  measures: { total: measure.count('id') },
});

// --- DatasetEntry.stream ---------------------------------------------------

type StreamOption = Exclude<Exclude<DatasetEntry, { __type: 'dataset' }>['stream'], undefined>;
export type _StreamOption = Expect<Equal<StreamOption, boolean | { maxRows?: number }>>;

const streamingEntries = {
  enabled: { dataset: Orders, stream: true },
  capped: { dataset: Orders, stream: { maxRows: 1_000_000 } },
  defaulted: { dataset: Orders, stream: {} },
  disabled: { dataset: Orders, stream: false },
} satisfies Record<string, DatasetEntry>;
void streamingEntries;

// @ts-expect-error maxRows is a number
export const badMaxRows: DatasetEntry = { dataset: Orders, stream: { maxRows: '100' } };
// @ts-expect-error stream takes a boolean or an options object
export const badStream: DatasetEntry = { dataset: Orders, stream: 'ndjson' };
// @ts-expect-error only maxRows is an option
export const unknownStreamOption: DatasetEntry = { dataset: Orders, stream: { maxRows: 10, format: 'arrow' } };

declare const builder: QueryBuilderFactoryLike;
const streamingApi = createAPI({
  queryBuilder: builder,
  datasets: { orders: { dataset: Orders, maxLimit: 100, stream: { maxRows: 10_000 } } },
});
void streamingApi;

// --- streamBody / ServeStreamBody / isServeStreamBody ----------------------

declare const bytes: ReadableStream<Uint8Array>;

const body = streamBody(bytes, NDJSON_MEDIA_TYPE);
export type _StreamBodyReturn = Expect<Equal<typeof body, ServeStreamBody>>;
export type _StreamBodyStream = Expect<Equal<ServeStreamBody['stream'], ReadableStream<Uint8Array>>>;
export type _StreamBodyContentType = Expect<Equal<ServeStreamBody['contentType'], string>>;
export type _StreamBodyFailure = Expect<Equal<ServeStreamBody['failure'], (() => unknown) | undefined>>;
export type _StreamBodyOptions = Expect<Equal<ServeStreamBodyOptions, { failure?: () => unknown }>>;

export const withFailure = streamBody(bytes, ARROW_STREAM_MEDIA_TYPE, { failure: () => undefined });

// @ts-expect-error the stream carries bytes, not rows
streamBody(new ReadableStream<Record<string, unknown>[]>(), NDJSON_MEDIA_TYPE);
// @ts-expect-error a content type is required
streamBody(bytes);
// @ts-expect-error the body is read-only
body.contentType = 'text/plain';
// @ts-expect-error only a stream body made by streamBody() qualifies
export const forged: ServeStreamBody = { contentType: 'text/plain', stream: bytes };

export type _NdjsonMediaType = Expect<Equal<typeof NDJSON_MEDIA_TYPE, 'application/x-ndjson'>>;
export type _ArrowMediaType = Expect<Equal<typeof ARROW_STREAM_MEDIA_TYPE, 'application/vnd.apache.arrow.stream'>>;

declare const unknownBody: unknown;
if (isServeStreamBody(unknownBody)) {
  type Narrowed = typeof unknownBody;
  type _Narrowed = Expect<Equal<Narrowed, ServeStreamBody>>;
}
export type _Guard = Expect<Equal<Parameters<typeof isServeStreamBody>, [value: unknown]>>;

// A handler may return a stream body.
export const streamingServe = defineServe({
  queries: {
    exportRows: { query: async () => streamBody(bytes, NDJSON_MEDIA_TYPE) },
  },
});

// --- Stream outcomes on hooks and query log events --------------------------

export type _Outcome = Expect<Equal<ServeStreamOutcome, 'completed' | 'failed' | 'cancelled'>>;
export type _Info = Expect<Equal<ServeStreamInfo, {
  outcome: ServeStreamOutcome;
  bytes: number;
  openDurationMs: number;
}>>;
export type _EndStream = Expect<Equal<RequestEndEvent['stream'], ServeStreamInfo | undefined>>;
export type _ErrorStream = Expect<Equal<RequestErrorEvent['stream'], ServeStreamInfo | undefined>>;
export type _LogStream = Expect<Equal<ServeQueryEvent['stream'], ServeStreamInfo | undefined>>;

export const hooked = defineServe({
  hooks: {
    onRequestEnd: (event) => {
      const outcome: ServeStreamOutcome | undefined = event.stream?.outcome;
      void outcome;
    },
    onError: (event) => {
      const sent: number | undefined = event.stream?.bytes;
      void sent;
    },
  },
  queries: {},
});

// --- Node adapter stream timeouts ------------------------------------------

export type _IdleTimeout = Expect<Equal<StartServerOptions['streamIdleTimeout'], number | undefined>>;
export type _TotalTimeout = Expect<Equal<StartServerOptions['streamTimeout'], number | undefined>>;
export const timeouts: StartServerOptions = { requestTimeout: 30_000, streamIdleTimeout: 0, streamTimeout: 600_000 };
// @ts-expect-error timeouts are milliseconds
export const badTimeout: StartServerOptions = { streamTimeout: '10m' };
