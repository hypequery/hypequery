import { initServe, type InferQueryResult } from '../index.js';
import { z } from 'zod';
import type { Equal, Expect } from '@type-challenges/utils';

type IsAny<T> = 0 extends (1 & T) ? true : false;

const serve = initServe({
  context: () => ({}),
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
