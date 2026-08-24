import { createQueryBuilder } from '../src/index.js';
import type { ExecuteOptions, InsertExecuteOptions, QueryExecutionOptions, StreamOptions } from '../src/index.js';
import type { TestSchema } from '../src/core/tests/test-utils.js';
import type { Equal, Expect } from '@type-challenges/utils';

type AssertExecuteSignal = Expect<Equal<ExecuteOptions['abortSignal'], AbortSignal | undefined>>;
type AssertStreamSignal = Expect<Equal<StreamOptions['abortSignal'], AbortSignal | undefined>>;
type AssertInsertSignal = Expect<Equal<InsertExecuteOptions['abortSignal'], AbortSignal | undefined>>;
type AssertAdapterSignal = Expect<Equal<QueryExecutionOptions['abortSignal'], AbortSignal | undefined>>;

const db = createQueryBuilder<TestSchema>({
  adapter: {
    name: 'type-test',
    query: async () => [],
    stream: async () => new ReadableStream(),
    insert: async () => ({ queryId: '', executed: true }),
  },
});

const signal = new AbortController().signal;

export const abortableQuery = () => db.table('users').select(['id']).execute({ abortSignal: signal });
export const abortableStream = () => db.table('users').select(['id']).stream({ abortSignal: signal });
export const abortableStreamForEach = () =>
  db.table('users').select(['id']).streamForEach(() => { }, { abortSignal: signal });
export const abortableInsert = () =>
  db.insert('users').values([]).execute({ abortSignal: signal });
export const abortableRawQuery = () => db.rawQuery('SELECT 1', [], { abortSignal: signal });
