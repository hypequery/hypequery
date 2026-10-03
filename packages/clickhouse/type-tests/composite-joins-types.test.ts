import { createQueryBuilder, type QueryBuilder } from '../src/core/query-builder.js';
import { setupTestBuilder, setupUsersBuilder, type TestSchema } from '../src/core/tests/test-utils.js';
import type { JoinKeyPairs } from '../src/index.js';
import type { Equal, Expect } from '@type-challenges/utils';

const builder = setupTestBuilder();
type State = typeof builder extends QueryBuilder<any, infer S> ? S : never;
const keys = [['created_by', 'users.id'], ['name', 'users.user_name']] as const satisfies JoinKeyPairs<State, 'users'>;

const joined = builder.innerJoin('users', keys, 'u').select(['id', 'u.email']);
type _Joined = Expect<Equal<Awaited<ReturnType<typeof joined.execute>>, { id: number; email: string }[]>>;
const left = builder.leftJoin('users', keys, 'u', { column: 'u.is_active', operator: 'eq', value: true });
const any = builder.leftAnyJoin('users', keys, 'u');
const right = builder.rightJoin('users', keys, 'u');
const full = builder.fullJoin('users', keys, 'u');
left.select(['u.email']);
any.select(['u.email']);
right.select(['u.email']);
full.select(['u.email']);

const rawCte = builder.withCTE('children', 'SELECT parent_id, label FROM children', {
  parent_id: 'Int32', label: 'String',
});
const cteKeys = [['id', 'children.parent_id'], ['name', 'children.label']] as const;
const cteQuery = rawCte.leftAnyJoin('children', cteKeys).select(['id', 'children.label']);
type _Cte = Expect<Equal<Awaited<ReturnType<typeof cteQuery.execute>>, { id: number; label: string }[]>>;
rawCte.innerJoin('children', cteKeys);
rawCte.leftJoin('children', cteKeys, undefined, { column: 'children.label', operator: 'eq', value: 'shown' });
rawCte.rightJoin('children', cteKeys);
rawCte.fullJoin('children', cteKeys);

builder.withCTE('people', setupUsersBuilder().select(['id', 'user_name']))
  .leftAnyJoin('people', [['created_by', 'people.id'], ['name', 'people.user_name']]);
const db = createQueryBuilder<TestSchema>({ adapter: builder.getAdapter(), dialect: builder.getDialect() });
db.withCTE('base', 'SELECT id, name FROM test_table', { id: 'Int32', name: 'String' })
  .table('base').innerJoin('users', [['id', 'users.id'], ['name', 'users.user_name']]);

// Each method rejects columns outside the base row or chosen target.
// @ts-expect-error unknown left column
builder.innerJoin('users', [['missing', 'users.id']]);
// @ts-expect-error unknown right column
builder.leftJoin('users', [['id', 'users.missing']]);
// @ts-expect-error wrong qualifier cannot widen the target
builder.leftAnyJoin('users', [['id', 'test_table.id']]);
// @ts-expect-error mixed targets cannot widen the target
builder.rightJoin('users', [['id', 'users.id'], ['id', 'test_table.id']]);
// @ts-expect-error unqualified right columns are rejected
builder.fullJoin('users', [['id', 'id']]);
// @ts-expect-error empty keys
builder.innerJoin('users', []);
// @ts-expect-error incomplete pair
builder.leftJoin('users', [['id']]);
// @ts-expect-error extra tuple element
builder.leftAnyJoin('users', [['id', 'users.id', 'users.email']]);
// @ts-expect-error wrong column on second pair
builder.innerJoin('users', [['id', 'users.id'], ['name', 'users.missing']]);
// @ts-expect-error aliased right input must still use the table qualifier
builder.innerJoin('users', [['id', 'u.id']], 'u');
// @ts-expect-error CTE aliases remain unsupported
rawCte.leftAnyJoin('children', cteKeys, 'c');
// @ts-expect-error unknown CTE column
rawCte.innerJoin('children', [['id', 'children.missing']]);
// @ts-expect-error undeclared CTE
builder.leftAnyJoin('undeclared', [['id', 'undeclared.id']]);
// @ts-expect-error untyped raw CTE
builder.withCTE('untyped', 'SELECT id FROM users').innerJoin('untyped', [['id', 'untyped.id']]);

// Existing argument positions, literal ON inputs and return inference are retained.
builder.innerJoin('users', 'created_by', 'users.id', 'u').select(['u.email']);
builder.leftJoin('users', 'created_by', 'users.id', 'u', { column: 'u.email', operator: 'eq', value: 'x' });
builder.leftAnyJoin('users', 'created_by', 'users.id', 'u', [{ column: 'u.email', operator: 'eq', value: 'x' }]);
builder.rightJoin('users', 'created_by', 'users.id', 'u').select(['u.email']);
builder.fullJoin('users', 'created_by', 'users.id', 'u').select(['u.email']);
