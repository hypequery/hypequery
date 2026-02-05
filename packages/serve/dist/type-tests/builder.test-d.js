import { initServe } from '../index.js';
import { z } from 'zod';
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
const _resultIsTyped = [{ plan: 'starter' }];
// @ts-expect-error plan must be string
const _resultRejectsNumber = [{ plan: 123 }];
