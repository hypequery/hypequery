import { initServe, type InferQueryResult } from '@hypequery/serve';
import { db } from './client';
import z from 'zod';


const { define, queries, query } = initServe({
  context: () => ({ db }),
})

export const api = define({
  queries: queries({
    tripsQuery: query
      .describe('Example query using the trips table')
      .input(z.object({ plan: z.string().optional() }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('trips')
          .select('*')
          .limit(10)
          .where('pickup_ntaname', 'like', input?.plan ?? '')
          .execute()
      ),
  }),
})


export type TripsQueryResult = InferQueryResult<typeof api, 'tripsQuery'>;

export const data = api.execute('tripsQuery')
export const queryTest = db.table('trips').select('*').execute()


/**
 * Inline usage example:
 *
 * const result = await api.execute('tripsQuery');
 * console.log(result);
 *
 * Dev server:
 *
 * npx hypequery dev
 */
