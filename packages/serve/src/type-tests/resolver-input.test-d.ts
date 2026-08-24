import { z } from 'zod';
import type { Equal, Expect } from '@type-challenges/utils';
import { initServe, type InferApiType } from '../index.js';

/**
 * Resolvers run after validation — `pipeline.ts` assigns
 * `context.input = validationResult.data` before invoking middlewares or the
 * handler. So the resolver sees zod's *output* type, while callers send its
 * *input* type. These tests pin both sides of that split.
 */

const serve = initServe({ context: () => ({ db: {} }) });
const { query } = serve;

// ---------------------------------------------------------------------------
// .default() — the common case
// ---------------------------------------------------------------------------

const withDefault = query({
  input: z.object({
    limit: z.number().int().default(10),
    name: z.string(),
  }),
  query: async ({ input }) => {
    // Required in the resolver: zod has already filled the default in.
    // Before this was fixed, `limit` was `number | undefined` and every caller
    // had to write `input.limit ?? 10`, restating a default the schema owns.
    type _LimitIsRequiredNumber = Expect<Equal<typeof input.limit, number>>;
    type _NameIsString = Expect<Equal<typeof input.name, string>>;

    const doubled: number = input.limit * 2;
    return [{ doubled }];
  },
});

// ---------------------------------------------------------------------------
// .transform() — resolver sees the transformed type
// ---------------------------------------------------------------------------

const withTransform = query({
  input: z.object({
    csv: z.string().transform((value) => value.split(',')),
  }),
  query: async ({ input }) => {
    type _CsvIsArray = Expect<Equal<typeof input.csv, string[]>>;
    return [{ count: input.csv.length }];
  },
});

// ---------------------------------------------------------------------------
// .coerce — resolver sees the coerced type
// ---------------------------------------------------------------------------

const withCoerce = query({
  input: z.object({
    since: z.coerce.date(),
  }),
  query: async ({ input }) => {
    type _SinceIsDate = Expect<Equal<typeof input.since, Date>>;
    return [{ iso: input.since.toISOString() }];
  },
});

// ---------------------------------------------------------------------------
// Callers still send the *input* type: a defaulted field stays optional there
// ---------------------------------------------------------------------------

export const api = serve.serve({
  queries: { withDefault, withTransform, withCoerce },
});

// This is the shape `@hypequery/react` consumes, so it must stay on the *input*
// side: over the wire a defaulted field is genuinely optional.
type Api = InferApiType<typeof api>;
type DefaultCallerInput = Api['withDefault']['input'];

// Omitting the defaulted field is valid over the wire.
const _callerMayOmitDefault: DefaultCallerInput = { name: 'a' };
// Supplying it is valid too.
const _callerMaySupplyDefault: DefaultCallerInput = { name: 'a', limit: 5 };
// The non-defaulted field is still required.
// @ts-expect-error `name` has no default, so callers must send it
const _callerMustSendName: DefaultCallerInput = { limit: 5 };

type TransformCallerInput = Api['withTransform']['input'];
// Callers send the pre-transform type.
const _callerSendsRawCsv: TransformCallerInput = { csv: 'a,b,c' };
// @ts-expect-error callers send the input side of the transform, not the output
const _callerCannotSendArray: TransformCallerInput = { csv: ['a', 'b'] };
