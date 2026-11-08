import { createQueryBuilder } from '../src/core/query-builder.js';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

interface Schema {
  events: { id: 'UInt32'; name: 'String' };
}

const db = createQueryBuilder<Schema>({ url: 'http://localhost:8123' });

async function assertStreams() {
  const rows = await db.table('events').select(['id']).stream();
  type _Rows = Assert<Equal<typeof rows, ReadableStream<{ id: number }[]>>>;

  const arrow = await db.table('events').select(['id']).streamArrow({ abortSignal: new AbortController().signal });
  type _Arrow = Assert<Equal<typeof arrow, ReadableStream<Uint8Array>>>;

  const raw = await db.rawStream<{ id: number }>('SELECT id FROM events WHERE id = ?', [1], { queryId: 'q' });
  type _Raw = Assert<Equal<typeof raw, ReadableStream<{ id: number }[]>>>;

  const rawArrow = await db.rawArrowStream('SELECT id FROM events');
  type _RawArrow = Assert<Equal<typeof rawArrow, ReadableStream<Uint8Array>>>;

  // @ts-expect-error parameters are an array
  await db.rawArrowStream('SELECT ?', 1);
}

void assertStreams;
