import { initServe, type InferQueryResult } from '@hypequery/serve';
import { z } from 'zod';

import { db } from './client';

const serve = initServe({
  context: () => ({ db }),
});
const { query: procedure } = serve;

export const api = serve.define({
  queries: serve.queries({
    tripsQuery: procedure
      .describe('Example query using the trips table')
      .input(z.object({ plan: z.string().optional() }))
      .query(async ({ ctx, input }) =>
        ctx.db.table('trips').select('*').limit(10).where(input).execute()
      ),
  }),
});

export type TripsQueryResult = InferQueryResult<typeof api, 'tripsQuery'>;

export const data = api.execute('tripsQuery');
export const direct = db.table('trips').select('*').execute();
