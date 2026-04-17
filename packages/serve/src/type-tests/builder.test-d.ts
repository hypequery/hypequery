import { initServe, type InferQueryResult } from '../index.js';
import { z } from 'zod';
import type { Equal, Expect } from '@type-challenges/utils';

type IsAny<T> = 0 extends (1 & T) ? true : false;

const serve = initServe({
  context: () => ({
    db: {},
  }),
});
const { query } = serve;

export const api = serve.define({
  queries: serve.queries({
    typedQuery: query
      .describe('builder infers input + output')
      .input(z.object({ plan: z.string().optional() }))
      .query(async ({ input }) => {
        const plan = input.plan ?? 'starter';
        return [{ plan }];
      }),
  }),
});

type TypedResult = InferQueryResult<typeof api, 'typedQuery'>;
type _TypedResultNotAny = Expect<Equal<IsAny<TypedResult>, false>>;
const _resultIsTyped: TypedResult = [{ plan: 'starter' }];
// @ts-expect-error plan must be string
const _resultRejectsNumber: TypedResult = [{ plan: 123 }];

const executableQuery = query({
  input: z.object({ startDate: z.string() }),
  output: z.object({ total: z.number() }),
  query: async ({ input, ctx }) => {
    ctx.db;
    return { total: Number(input.startDate.length) };
  },
});

const executableResultPromise = executableQuery.execute({
  input: { startDate: '2024-01-01' },
});

type ExecutableResult = Awaited<typeof executableResultPromise>;
const _executableResultIsTyped: ExecutableResult = { total: 10 };
// @ts-expect-error total must be number
const _executableResultRejectsString: ExecutableResult = { total: '10' };
