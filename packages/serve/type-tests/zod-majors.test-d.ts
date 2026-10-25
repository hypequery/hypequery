/**
 * Serve depends on Zod 4 but types its schema slots structurally, so callers
 * can bring Zod 3 or Zod 4. Checked by `tsconfig.type-tests.json`;
 * `@ts-expect-error` lines must remain errors.
 */
import { z as zod4 } from 'zod';
import { z as zod3 } from 'zod/v3';
import { query, type SchemaInput, type SchemaOutput, type ServeSchema } from '../src/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const zod3Input = zod3.object({ limit: zod3.number().default(10), status: zod3.string().optional() });
const zod4Input = zod4.object({ limit: zod4.number().default(10), status: zod4.string().optional() });

// Both majors satisfy the structural schema type.
const accepted: ServeSchema[] = [zod3Input, zod4Input];
void accepted;

type Zod3In = SchemaInput<typeof zod3Input>;
type Zod4In = SchemaInput<typeof zod4Input>;
type Zod3Out = SchemaOutput<typeof zod3Input>;
type Zod4Out = SchemaOutput<typeof zod4Input>;

export type InputsAgree = Expect<Equal<Zod3In['limit'], number | undefined>>;
export type InputsAgree4 = Expect<Equal<Zod4In['limit'], number | undefined>>;
export type OutputsAgree = Expect<Equal<Zod3Out['limit'], number>>;
export type OutputsAgree4 = Expect<Equal<Zod4Out['limit'], number>>;

query({
  input: zod3Input,
  output: zod3.object({ total: zod3.number() }),
  query: async ({ input }) => {
    const limit: number = input.limit;
    // @ts-expect-error status is optional, so it may be undefined
    const status: string = input.status;
    void status;
    return { total: limit };
  },
});

query({
  input: zod4Input,
  output: zod4.object({ total: zod4.number() }),
  query: async ({ input }) => {
    const limit: number = input.limit;
    // @ts-expect-error status is optional, so it may be undefined
    const status: string = input.status;
    void status;
    return { total: limit };
  },
});

// @ts-expect-error a plain object is not a schema
const rejected: ServeSchema = { parse: (value: unknown) => value };
void rejected;
