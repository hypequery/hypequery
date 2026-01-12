import { defineServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

export const api = defineServe({
  context: () => ({ db }),
  queries: {
    tripsQuery: {
      description: 'Example query using the trips table',
      query: async ({ ctx }) =>
        ctx.db
          .from('trips')
          .select('*')
          .limit(10),
      outputSchema: z.array(z.any()),
    },
  },
});

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
