import { setupTestBuilder } from '../src/core/tests/test-utils.js';
import type { Equal, Expect } from '@type-challenges/utils';
const builder = setupTestBuilder();
const joined = builder.singleMatchJoin('users', [
  { leftColumn: 'created_by', rightColumn: 'users.id' },
  { leftColumn: 'updated_by', rightColumn: 'users.id' },
], 'user').select(['id', 'user.email']);
type Result = Awaited<ReturnType<typeof joined.execute>>;
type AssertProjection = Expect<Equal<Result, { id: number; email: string }[]>>;
void joined;
// @ts-expect-error composite joins require at least one equality
builder.singleMatchJoin('users', []);
// @ts-expect-error source columns stay schema constrained
builder.singleMatchJoin('users', [{ leftColumn: 'missing', rightColumn: 'users.id' }]);
// @ts-expect-error target columns stay schema constrained
builder.singleMatchJoin('users', [{ leftColumn: 'id', rightColumn: 'users.missing' }]);
// @ts-expect-error every equality needs a right column
builder.singleMatchJoin('users', [{ leftColumn: 'id' }]);
