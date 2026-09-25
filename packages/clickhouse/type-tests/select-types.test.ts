import { createQueryBuilder } from '../src/core/query-builder.js';
import { setupTestBuilder, setupUsersBuilder } from '../src/core/tests/test-utils.js';
import { formatDateTime } from '../src/core/utils/sql-expressions.js';
import type { Equal, Expect } from '@type-challenges/utils';

const builder = setupTestBuilder();

const stringAliases = builder.select(['id as order_id', 'name AS label', 'test_table.price As cost']);
type AssertStringAliases = Expect<Equal<
  Awaited<ReturnType<typeof stringAliases.execute>>,
  { order_id: number; label: string; cost: number }[]
>>;

const constAliases = builder.selectConst('id', 'name as label');
type AssertConstAliases = Expect<Equal<
  Awaited<ReturnType<typeof constAliases.execute>>,
  { id: number; label: string }[]
>>;

const mixedSelection = builder.select(['id', formatDateTime('created_at', 'Y-%m-%d', { alias: 'day' })]);
type AssertMixedSelection = Expect<Equal<
  Awaited<ReturnType<typeof mixedSelection.execute>>,
  { id: number; day: string }[]
>>;

const pretyped: ('id' | 'name')[] = ['id'];
const pretypedSelection = builder.select(pretyped);
type AssertPretypedSelection = Expect<Equal<
  Awaited<ReturnType<typeof pretypedSelection.execute>>,
  { id: number; name: string }[]
>>;

// @ts-expect-error - unknown column
builder.select(['id', 'nope']);
// @ts-expect-error - unknown aliased column
builder.select(['nope as x']);
// @ts-expect-error - unknown qualified aliased column
builder.select(['users.id as x']);
// @ts-expect-error - unknown column
builder.selectConst('id', 'nope');
// @ts-expect-error - unknown aliased column
builder.selectConst('nope as x');

setupUsersBuilder().select(['users.email as contact']);

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type WideColumn = `col_${Digit}${Digit}${Digit}`;
interface WideSchema {
  wide: { id: 'String' } & Record<WideColumn, 'Nullable(String)'>;
}

const wide = createQueryBuilder<WideSchema>({
  adapter: builder.getAdapter(),
  dialect: builder.getDialect(),
}).table('wide');

const wideSelection = wide.select(['id', 'col_999 as last']);
type AssertWideSelection = Expect<Equal<
  Awaited<ReturnType<typeof wideSelection.execute>>,
  { id: string; last: string | null }[]
>>;
// @ts-expect-error - unknown column on a wide table
wide.select(['col_1000']);
